import { scheduledExportRepository } from "../repositories/scheduledExportRepository.js";
import { scheduledExportRunRepository } from "../repositories/scheduledExportRunRepository.js";
import crypto from "crypto";
import { Prisma } from "../generated/prisma/index.js";
import { prisma } from "../config/database.js";
import {
  assertScheduledExportAccess,
  assertScheduledExportActiveLimit,
  MAX_ACTIVE_SCHEDULED_EXPORTS,
} from "./scheduledExportPlanService.js";
import {
  buildScheduledExportScheduleInput,
  computeScheduledExportNextRunAt,
} from "./scheduledExportScheduleService.js";
import logger from "../utils/loggerUtils.js";
import {
  normalizeExportPreset,
  resolveExportFields,
} from "../modules/productExports/exportPresets.js";
import { stableCanonicalStringify } from "../utils/stableCanonicalStringify.js";
import { assertShadowWriteAllowed } from "./shadowReadOnlyGuardService.js";

const FILTER_VERSION = "scheduled_export.filter.v1";
const SCHEDULE_VERSION = "scheduled_export.schedule.v1";
const DEDUPE_VERSION = "scheduled_export.dedupe.v1";
const DETERMINISM_META_KEY = "__determinism";
const MAX_REQUESTED_COLUMNS = 200;
const MAX_REQUESTED_COLUMNS_BYTES = 16 * 1024;

const ALLOWED_STATUS_TRANSITIONS = {
  ACTIVE: new Set(["ACTIVE", "PAUSED", "CANCELLED", "FAILED"]),
  PAUSED: new Set(["PAUSED", "ACTIVE", "CANCELLED"]),
  FAILED: new Set(["FAILED", "ACTIVE", "CANCELLED"]),
  COMPLETED: new Set(["COMPLETED"]),
  CANCELLED: new Set(["CANCELLED"]),
};

function normalizeStatus(rawStatus, fallback = "ACTIVE") {
  if (!rawStatus) return fallback;

  const value = String(rawStatus).trim().toUpperCase();
  switch (value) {
    case "ACTIVE":
    case "PAUSED":
    case "COMPLETED":
    case "FAILED":
    case "CANCELLED":
      return value;
    case "INACTIVE":
      return "PAUSED";
    default:
      throw new Error("Unsupported scheduled export status");
  }
}

function normalizeFilename(filename) {
  const value = String(filename || "").trim();
  if (!value) {
    throw new Error("filename is required");
  }
  const firstChar = value[0];
  if (["=", "+", "-", "@", "\t"].includes(firstChar)) {
    throw new Error("filename has unsupported leading character");
  }

  return value.endsWith(".csv") ? value : `${value}.csv`;
}

function validateFields(fields = []) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error("fields are required");
  }

  const normalized = Array.from(
    new Set(fields.map((field) => String(field).trim()).filter(Boolean)),
  ).sort();
  if (normalized.length > MAX_REQUESTED_COLUMNS) {
    throw new Error("Too many requested columns");
  }
  const bytes = Buffer.byteLength(JSON.stringify(normalized), "utf8");
  if (bytes > MAX_REQUESTED_COLUMNS_BYTES) {
    throw new Error("requested columns payload too large");
  }
  return normalized;
}

function normalizeFilterParams(filterParams) {
  if (!Array.isArray(filterParams)) return [];
  const canonical = JSON.parse(stableCanonicalStringify(filterParams));
  const bytes = Buffer.byteLength(JSON.stringify(canonical), "utf8");
  if (bytes > 256 * 1024) {
    throw new Error("filterParams payload too large");
  }
  return canonical;
}

function hashDeterministic(value) {
  return crypto.createHash("sha256").update(stableCanonicalStringify(value)).digest("hex");
}

function sanitizeScheduleConfig(scheduleConfig) {
  if (!scheduleConfig || typeof scheduleConfig !== "object" || Array.isArray(scheduleConfig)) {
    return {};
  }
  const next = { ...scheduleConfig };
  delete next[DETERMINISM_META_KEY];
  return next;
}

function buildDeterminismMetadata({
  shop,
  scheduleInput,
  filterParams,
  requestedColumns,
  filename,
}) {
  const canonicalSchedule = {
    scheduleType: scheduleInput.scheduleType,
    timezone: scheduleInput.timezone,
    scheduleConfig: sanitizeScheduleConfig(scheduleInput.scheduleConfig),
    cronExpression: scheduleInput.cronExpression || null,
    intervalMinutes: scheduleInput.intervalMinutes || null,
    startAt: scheduleInput.startAt ? new Date(scheduleInput.startAt).toISOString() : null,
    endAt: scheduleInput.endAt ? new Date(scheduleInput.endAt).toISOString() : null,
  };

  const filterFingerprint = hashDeterministic({
    version: FILTER_VERSION,
    filterParams,
  });
  const scheduleFingerprint = hashDeterministic({
    version: SCHEDULE_VERSION,
    schedule: canonicalSchedule,
  });
  const dedupeKey = hashDeterministic({
    version: DEDUPE_VERSION,
    shop,
    scheduleFingerprint,
    filterFingerprint,
    requestedColumns,
    filename,
  });

  return {
    filterVersion: FILTER_VERSION,
    scheduleVersion: SCHEDULE_VERSION,
    dedupeVersion: DEDUPE_VERSION,
    filterFingerprint,
    scheduleFingerprint,
    dedupeKey,
  };
}

function withDeterminismMetadata(scheduleConfig, determinismMeta) {
  return {
    ...sanitizeScheduleConfig(scheduleConfig),
    [DETERMINISM_META_KEY]: determinismMeta,
  };
}

function extractDeterminismMeta(scheduleConfig) {
  if (!scheduleConfig || typeof scheduleConfig !== "object" || Array.isArray(scheduleConfig)) {
    return null;
  }
  const meta = scheduleConfig[DETERMINISM_META_KEY];
  if (!meta || typeof meta !== "object") return null;
  return meta;
}

function computeRecordDedupeKey(record) {
  const existingMeta = extractDeterminismMeta(record.scheduleConfig);
  if (existingMeta?.dedupeKey && typeof existingMeta.dedupeKey === "string") {
    return existingMeta.dedupeKey;
  }

  const scheduleInput = {
    scheduleType: record.scheduleType,
    timezone: record.timezone,
    scheduleConfig: record.scheduleConfig,
    cronExpression: record.cronExpression,
    intervalMinutes: record.intervalMinutes,
    startAt: record.startAt,
    endAt: record.endAt,
  };
  const filterParams = normalizeFilterParams(record.filterParams);
  const requestedColumns = validateFields(
    Array.isArray(record.requestedColumns) ? record.requestedColumns : record.fields || [],
  );
  const filename = normalizeFilename(record.filename || "export.csv");

  return buildDeterminismMetadata({
    shop: record.shop,
    scheduleInput,
    filterParams,
    requestedColumns,
    filename,
  }).dedupeKey;
}

async function assertNoScheduledExportDuplicate({
  shop,
  dedupeKey,
  excludeScheduledExportId = null,
  db = null,
}) {
  const existing = await scheduledExportRepository.listByShop({
    shop,
    take: 10_000,
    db: db || undefined,
  });

  const duplicate = existing.find((item) => {
    if (excludeScheduledExportId && item.id === excludeScheduledExportId) return false;
    return computeRecordDedupeKey(item) === dedupeKey;
  });

  if (duplicate) {
    const error = new Error("SCHEDULED_EXPORT_DUPLICATE");
    error.code = "SCHEDULED_EXPORT_DUPLICATE";
    error.duplicateScheduledExportId = duplicate.id;
    throw error;
  }
}

function assertStatusTransitionAllowed(currentStatus, nextStatus) {
  const current = normalizeStatus(currentStatus, "ACTIVE");
  const next = normalizeStatus(nextStatus, current);
  const allowed = ALLOWED_STATUS_TRANSITIONS[current];
  if (!allowed || !allowed.has(next)) {
    const error = new Error("SCHEDULED_EXPORT_STATUS_TRANSITION_INVALID");
    error.code = "SCHEDULED_EXPORT_STATUS_TRANSITION_INVALID";
    error.details = { from: current, to: next };
    throw error;
  }
}

function assertNextRunMonotonic({ previousNextRunAt, nextRunAt, nextStatus }) {
  if (normalizeStatus(nextStatus, "ACTIVE") !== "ACTIVE") return;
  if (!previousNextRunAt || !nextRunAt) return;
  const prevTs = new Date(previousNextRunAt).getTime();
  const nextTs = new Date(nextRunAt).getTime();
  if (Number.isNaN(prevTs) || Number.isNaN(nextTs)) return;
  if (nextTs <= prevTs) {
    const error = new Error("SCHEDULED_EXPORT_NEXT_RUN_NOT_MONOTONIC");
    error.code = "SCHEDULED_EXPORT_NEXT_RUN_NOT_MONOTONIC";
    throw error;
  }
}

function mapStatusForClient(status) {
  switch (status) {
    case "ACTIVE":
      return "Active";
    case "PAUSED":
      return "Inactive";
    case "COMPLETED":
      return "Completed";
    case "FAILED":
      return "Failed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}

function mapFrequencyForClient(item) {
  if (item.scheduleType === "ONE_TIME") {
    return "Once";
  }

  if (item.scheduleType === "EVERY_X_MINUTES") {
    if (item.intervalMinutes === 60) return "Hourly";
    if (item.intervalMinutes === 120) return "Every 2 Hours";
    return "Every X Minutes";
  }

  return item.scheduleType.toLowerCase().replace(/^\w/, (char) => char.toUpperCase());
}

function indexRunCounts(statusCounts = []) {
  return statusCounts.reduce((accumulator, row) => {
    const current = accumulator[row.scheduledExportId] || {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
    };

    current.total += row._count._all;
    if (row.status === "SUCCESS") current.success += row._count._all;
    if (row.status === "FAILED") current.failed += row._count._all;
    if (row.status === "SKIPPED") current.skipped += row._count._all;

    accumulator[row.scheduledExportId] = current;
    return accumulator;
  }, {});
}

function indexLatestRuns(runs = []) {
  const latestByScheduledExport = {};

  for (const run of runs) {
    if (!latestByScheduledExport[run.scheduledExportId]) {
      latestByScheduledExport[run.scheduledExportId] = run;
    }
  }

  return latestByScheduledExport;
}

function serializeScheduledExport(item, countsById = {}, latestRunsById = {}) {
  const counts = countsById[item.id] || {
    total: item.runCount || 0,
    success: 0,
    failed: 0,
    skipped: 0,
  };
  const latestRun = latestRunsById[item.id] || null;

  return {
    _id: item.id,
    id: item.id,
    shop: item.shop,
    title: item.title,
    status: mapStatusForClient(item.status),
    statusKey: item.status,
    frequency: mapFrequencyForClient(item),
    scheduleType: item.scheduleType,
    timezone: item.timezone,
    scheduleConfig: item.scheduleConfig,
    cronExpression: item.cronExpression,
    intervalMinutes: item.intervalMinutes,
    fields: Array.isArray(item.requestedColumns)
      ? item.requestedColumns
      : Array.isArray(item.fields)
        ? item.fields
        : [],
    filename: item.filename,
    filterParams: item.filterParams,
    totalRuns: counts.total,
    successfulRuns: counts.success,
    totalRunsSucceed: counts.success,
    totalRunsSkipped: counts.skipped,
    totalFails: counts.failed,
    runCount: item.runCount,
    nextRun: item.nextRunAt,
    nextRunAt: item.nextRunAt,
    lastRunAt: item.lastRunAt,
    lastSuccessAt: item.lastSuccessAt,
    lastFailureAt: item.lastFailureAt,
    lastFailureReason: item.lastFailureReason,
    lastRunStatus: latestRun?.status ?? null,
    lastRunMessage: latestRun?.errorMessage ?? item.lastFailureReason ?? null,
    lastFileUrl: latestRun?.fileUrl ?? null,
    startAt: item.startAt,
    endAt: item.endAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

async function getScheduledExportHydrated(id, shop) {
  const scheduledExport = await scheduledExportRepository.findByIdForShop(id, shop);
  if (!scheduledExport) {
    throw new Error("Scheduled export not found");
  }

  const [statusCounts, latestRuns] = await Promise.all([
    scheduledExportRunRepository.groupStatusCounts([scheduledExport.id]),
    scheduledExportRunRepository.findLatestRuns([scheduledExport.id]),
  ]);

  return serializeScheduledExport(
    scheduledExport,
    indexRunCounts(statusCounts),
    indexLatestRuns(latestRuns),
  );
}

export async function createScheduledExport({
  shop,
  body,
  subscription,
  now = new Date(),
  executionContext = null,
}) {
  assertShadowWriteAllowed(executionContext, "scheduled_export.create");
  await assertScheduledExportAccess(subscription);

  const preset = normalizeExportPreset(body.preset);
  const requestedColumns = validateFields(
    resolveExportFields({
      fields: body.requestedColumns ?? body.fields,
      preset,
    }),
  );
  const filename = normalizeFilename(body.filename);
  const filterParams = normalizeFilterParams(body.filterParams);
  const status = normalizeStatus(body.status, "ACTIVE");
  const scheduleInput = buildScheduledExportScheduleInput({
    ...body,
  });
  const title = String(body.title || "").trim() || filename.replace(/\.csv$/i, "");
  const determinismMeta = buildDeterminismMetadata({
    shop,
    scheduleInput,
    filterParams,
    requestedColumns,
    filename,
  });
  const nextRunAt =
    status === "ACTIVE"
      ? computeScheduledExportNextRunAt(
          { ...scheduleInput, status, endAt: scheduleInput.endAt },
          now,
        )
      : null;

  if (status === "ACTIVE" && !nextRunAt) {
    throw new Error("Scheduled export time must be in the future");
  }
  const created = await prisma.$transaction(
    async (tx) => {
      if (status === "ACTIVE") {
        const activeCount = await scheduledExportRepository.countActiveByShop(
          shop,
          null,
          tx,
        );
        if (activeCount >= MAX_ACTIVE_SCHEDULED_EXPORTS) {
          const error = new Error(
            `Your store already has ${MAX_ACTIVE_SCHEDULED_EXPORTS} active scheduled exports. Pause or delete one before activating another.`,
          );
          error.code = "SCHEDULED_EXPORT_ACTIVE_LIMIT_REACHED";
          error.statusCode = 403;
          throw error;
        }
      }

      await assertNoScheduledExportDuplicate({
        shop,
        dedupeKey: determinismMeta.dedupeKey,
        db: tx,
      });

      return scheduledExportRepository.create(
        {
          shop,
          title,
          status,
          scheduleType: scheduleInput.scheduleType,
          timezone: scheduleInput.timezone,
          scheduleConfig: withDeterminismMetadata(scheduleInput.scheduleConfig, determinismMeta),
          cronExpression: scheduleInput.cronExpression,
          intervalMinutes: scheduleInput.intervalMinutes,
          startAt: scheduleInput.startAt,
          endAt: scheduleInput.endAt,
          filterParams,
          requestedColumns,
          filename,
          nextRunAt,
        },
        tx,
      );
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );

  logger.info("Scheduled export created", {
    shop,
    scheduledExportId: created.id,
    nextRunAt: created.nextRunAt,
  });

  return getScheduledExportHydrated(created.id, shop);
}

export async function listScheduledExports({ shop }) {
  const items = await scheduledExportRepository.listByShop(shop);
  const ids = items.map((item) => item.id);
  const [statusCounts, latestRuns] = await Promise.all([
    scheduledExportRunRepository.groupStatusCounts(ids),
    scheduledExportRunRepository.findLatestRuns(ids),
  ]);

  const countsById = indexRunCounts(statusCounts);
  const latestRunsById = indexLatestRuns(latestRuns);

  return items.map((item) => serializeScheduledExport(item, countsById, latestRunsById));
}

export async function getScheduledExportById({ shop, scheduledExportId }) {
  return getScheduledExportHydrated(scheduledExportId, shop);
}

export async function updateScheduledExport({
  shop,
  scheduledExportId,
  body,
  subscription,
  now = new Date(),
  executionContext = null,
  expectedUpdatedAt = null,
}) {
  assertShadowWriteAllowed(executionContext, "scheduled_export.update");
  const existing = await scheduledExportRepository.findByIdForShop(scheduledExportId, shop);
  if (!existing) {
    throw new Error("Scheduled export not found");
  }

  const nextStatus = normalizeStatus(body.status, existing.status);
  assertStatusTransitionAllowed(existing.status, nextStatus);
  if (nextStatus === "ACTIVE") {
    await assertScheduledExportAccess(subscription);
    await assertScheduledExportActiveLimit({
      shop,
      excludeScheduledExportId: existing.id,
    });
  }

  const scheduleInput = buildScheduledExportScheduleInput(
    {
      ...body,
      timezone: body.timezone ?? existing.timezone ?? "UTC",
      startAt: body.startAt ?? existing.startAt,
      endAt: body.endAt ?? existing.endAt,
      scheduleConfig: body.scheduleConfig ?? existing.scheduleConfig,
      intervalMinutes: body.intervalMinutes ?? existing.intervalMinutes,
      cronExpression: body.cronExpression ?? existing.cronExpression,
    },
    existing,
  );

  const requestedColumns = body.requestedColumns || body.fields || body.preset
    ? validateFields(
        resolveExportFields({
          fields: body.requestedColumns ?? body.fields,
          preset: normalizeExportPreset(body.preset),
        }),
      )
    : Array.isArray(existing.requestedColumns)
      ? existing.requestedColumns
      : existing.fields;
  const filename =
    body.filename !== undefined
      ? normalizeFilename(body.filename)
      : existing.filename;
  const filterParams = Array.isArray(body.filterParams)
    ? normalizeFilterParams(body.filterParams)
    : existing.filterParams;
  const title =
    body.title !== undefined
      ? String(body.title || "").trim() || filename.replace(/\.csv$/i, "")
      : existing.title;
  const determinismMeta = buildDeterminismMetadata({
    shop,
    scheduleInput,
    filterParams: normalizeFilterParams(filterParams),
    requestedColumns,
    filename,
  });
  await assertNoScheduledExportDuplicate({
    shop,
    dedupeKey: determinismMeta.dedupeKey,
    excludeScheduledExportId: existing.id,
  });
  const nextRunAt =
    nextStatus === "ACTIVE"
      ? computeScheduledExportNextRunAt(
          {
            ...existing,
            ...scheduleInput,
            status: nextStatus,
            endAt: scheduleInput.endAt,
          },
          now,
        )
      : null;

  if (nextStatus === "ACTIVE" && !nextRunAt) {
    throw new Error("Scheduled export time must be in the future");
  }
  assertNextRunMonotonic({
    previousNextRunAt: existing.nextRunAt,
    nextRunAt,
    nextStatus,
  });

  const updateResult = await scheduledExportRepository.updateByIdForShopWithUpdatedAt({
    id: existing.id,
    shop,
    expectedUpdatedAt: expectedUpdatedAt || body.expectedUpdatedAt || existing.updatedAt,
    data: {
    title,
    status: nextStatus,
    scheduleType: scheduleInput.scheduleType,
    timezone: scheduleInput.timezone,
    scheduleConfig: withDeterminismMetadata(scheduleInput.scheduleConfig, determinismMeta),
    cronExpression: scheduleInput.cronExpression,
    intervalMinutes: scheduleInput.intervalMinutes,
    startAt: scheduleInput.startAt,
    endAt: scheduleInput.endAt,
    filterParams,
    requestedColumns,
    filename,
    nextRunAt,
    isDeleted: false,
    },
  });
  if (updateResult.count !== 1) {
    const error = new Error("SCHEDULED_EXPORT_CONFLICT");
    error.code = "SCHEDULED_EXPORT_CONFLICT";
    throw error;
  }

  return getScheduledExportHydrated(existing.id, shop);
}

export async function toggleScheduledExportStatus({
  shop,
  scheduledExportId,
  status,
  subscription,
  now = new Date(),
  executionContext = null,
  expectedUpdatedAt = null,
}) {
  assertShadowWriteAllowed(executionContext, "scheduled_export.toggle");
  const existing = await scheduledExportRepository.findByIdForShop(scheduledExportId, shop);
  if (!existing) {
    throw new Error("Scheduled export not found");
  }

  const requestedStatus = normalizeStatus(
    status,
    existing.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
  );
  assertStatusTransitionAllowed(existing.status, requestedStatus);

  if (requestedStatus === "ACTIVE") {
    await assertScheduledExportAccess(subscription);
    await assertScheduledExportActiveLimit({
      shop,
      excludeScheduledExportId: existing.id,
    });
  }

  const nextRunAt =
    requestedStatus === "ACTIVE"
      ? computeScheduledExportNextRunAt(existing, now)
      : null;

  if (requestedStatus === "ACTIVE" && !nextRunAt) {
    throw new Error("Scheduled export time must be in the future");
  }
  assertNextRunMonotonic({
    previousNextRunAt: existing.nextRunAt,
    nextRunAt,
    nextStatus: requestedStatus,
  });

  const toggleResult = await scheduledExportRepository.updateByIdForShopWithUpdatedAt({
    id: existing.id,
    shop,
    expectedUpdatedAt: expectedUpdatedAt || existing.updatedAt,
    data: {
      status: requestedStatus,
      nextRunAt,
    },
  });
  if (toggleResult.count !== 1) {
    const error = new Error("SCHEDULED_EXPORT_CONFLICT");
    error.code = "SCHEDULED_EXPORT_CONFLICT";
    throw error;
  }

  return getScheduledExportHydrated(existing.id, shop);
}

export async function deleteScheduledExport({
  shop,
  scheduledExportId,
  now = new Date(),
  executionContext = null,
  expectedUpdatedAt = null,
}) {
  assertShadowWriteAllowed(executionContext, "scheduled_export.delete");
  const existing = await scheduledExportRepository.findByIdForShop(scheduledExportId, shop);
  if (!existing) {
    throw new Error("Scheduled export not found");
  }
  assertStatusTransitionAllowed(existing.status, "CANCELLED");

  const deleteResult = await scheduledExportRepository.updateByIdForShopWithUpdatedAt({
    id: existing.id,
    shop,
    expectedUpdatedAt: expectedUpdatedAt || existing.updatedAt,
    data: {
      status: "CANCELLED",
      isDeleted: true,
      nextRunAt: null,
      endAt: existing.endAt || now,
    },
  });
  if (deleteResult.count !== 1) {
    const error = new Error("SCHEDULED_EXPORT_CONFLICT");
    error.code = "SCHEDULED_EXPORT_CONFLICT";
    throw error;
  }

  return {
    id: existing.id,
    deleted: true,
  };
}
