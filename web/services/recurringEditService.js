import { prisma } from "../config/database.js";
import { productFilterService } from "./productService/productFilterService.js";
import { getUpdatedProducts } from "../helpers/productBulkOperationHelpers/productUpdateHandler.js";
import { recurringEditRepository } from "../repositories/recurringEditRepository.js";
import { recurringEditRunRepository } from "../repositories/recurringEditRunRepository.js";
import {
  assertProRecurringEditAccessForShop,
  assertRecurringEditActiveLimit,
} from "./recurringEditPlanService.js";
import {
  buildRecurringScheduleInput,
  computeRecurringEditNextRunAt,
} from "./recurringEditScheduleService.js";
import logger from "../utils/loggerUtils.js";
import { normalizeIncomingBulkPayload } from "../utils/canonicalBulkPayload.js";
import { validateCanonicalPayloadEnvelope } from "../validations/canonicalPayloadEnvelopeValidator.js";

const SCHEDULE_DETERMINISM_META_KEY = "__scheduleDeterminism";

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

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
      throw new Error("Unsupported recurring edit status");
  }
}

function buildRulesFromBody(body = {}) {
  const normalized = normalizeIncomingBulkPayload(body);

  if (Array.isArray(body.rules) && body.rules.length > 0) {
    return body.rules;
  }

  if (!normalized.editedField) {
    throw new Error("rules are required");
  }

  return [
    {
      field: normalized.editedField,
      value: normalized.value ?? null,
      editOption: normalized.editedBy ?? null,
      searchKey: normalized.searchKey ?? null,
      replaceText: normalized.replaceText ?? null,
      supportValue: normalized.supportValue ?? null,
      locationId: normalized.locationId ?? null,
    },
  ];
}

function validateRules(rules = []) {
  if (!Array.isArray(rules) || rules.length !== 1) {
    throw new Error(
      "Recurring edits require exactly one rule in the current bulk edit pipeline",
    );
  }

  const [rule] = rules;
  if (!rule?.field) throw new Error("Recurring edit rule.field is required");
  if (!rule?.editOption) {
    throw new Error("Recurring edit rule.editOption is required");
  }

  return rule;
}

function buildDefaultTitle(rule) {
  return getUpdatedProducts({
    field: rule.field,
    editType: rule.editOption,
    value: rule.value,
    supportValue: rule.supportValue,
    searchKey: rule.searchKey,
    replaceText: rule.replaceText,
    returnTitleOnly: true,
  });
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

function mapFrequencyForClient(edit) {
  if (edit.scheduleType === "EVERY_X_MINUTES") {
    if (edit.intervalMinutes === 60) return "Hourly";
    if (edit.intervalMinutes === 120) return "Every 2 Hours";
    return "Every X Minutes";
  }

  return edit.scheduleType.toLowerCase().replace(/^\w/, (char) => char.toUpperCase());
}

function indexRunCounts(statusCounts = []) {
  return statusCounts.reduce((accumulator, row) => {
    const current = accumulator[row.recurringEditId] || {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
    };

    current.total += row._count._all;
    if (row.status === "SUCCESS") current.success += row._count._all;
    if (row.status === "FAILED") current.failed += row._count._all;
    if (row.status === "SKIPPED") current.skipped += row._count._all;

    accumulator[row.recurringEditId] = current;
    return accumulator;
  }, {});
}

function indexLatestRuns(runs = []) {
  const latestByRecurringEdit = {};

  for (const run of runs) {
    if (!latestByRecurringEdit[run.recurringEditId]) {
      latestByRecurringEdit[run.recurringEditId] = run;
    }
  }

  return latestByRecurringEdit;
}

function serializeRecurringEdit(edit, countsById = {}, latestRunsById = {}) {
  const counts = countsById[edit.id] || {
    total: edit.runCount || 0,
    success: 0,
    failed: 0,
    skipped: 0,
  };
  const latestRun = latestRunsById[edit.id] || null;

  return {
    _id: edit.id,
    id: edit.id,
    shop: edit.shop,
    title: edit.title,
    status: mapStatusForClient(edit.status),
    statusKey: edit.status,
    frequency: mapFrequencyForClient(edit),
    scheduleType: edit.scheduleType,
    timezone: edit.timezone,
    scheduleConfig: edit.scheduleConfig,
    scheduleFingerprint:
      edit?.scheduleConfig?.[SCHEDULE_DETERMINISM_META_KEY]?.scheduleFingerprint || null,
    cronExpression: edit.cronExpression,
    intervalMinutes: edit.intervalMinutes,
    timeToRun: edit.scheduleConfig?.time ?? null,
    dayOfMonthToRun: edit.scheduleConfig?.dayOfMonth ?? null,
    daysOfWeekToRun: Array.isArray(edit.scheduleConfig?.weekdays)
      ? edit.scheduleConfig.weekdays.map(
          (weekday) => WEEKDAY_NAMES[weekday] ?? String(weekday),
        )
      : [],
    totalRuns: counts.total,
    successfulRuns: counts.success,
    totalRunsSucceed: counts.success,
    totalRunsSkipped: counts.skipped,
    totalFails: counts.failed,
    runCount: edit.runCount,
    nextRun: edit.nextRunAt,
    nextRunAt: edit.nextRunAt,
    lastRunAt: edit.lastRunAt,
    lastSuccessAt: edit.lastSuccessAt,
    lastFailureAt: edit.lastFailureAt,
    lastFailureReason: edit.lastFailureReason,
    lastRunStatus: latestRun?.status ?? null,
    lastRunMessage: latestRun?.errorMessage ?? edit.lastFailureReason ?? null,
    rules: edit.rules,
    steps: edit.rules,
    filterParams: edit.filterParams,
    queryFilter: JSON.stringify(edit.filterParams),
    startAt: edit.startAt,
    endAt: edit.endAt,
    createdAt: edit.createdAt,
    updatedAt: edit.updatedAt,
  };
}

function withScheduleDeterminismMetadata(scheduleConfig, scheduleInput) {
  const baseConfig =
    scheduleConfig && typeof scheduleConfig === "object" && !Array.isArray(scheduleConfig)
      ? { ...scheduleConfig }
      : {};

  delete baseConfig[SCHEDULE_DETERMINISM_META_KEY];

  return {
    ...baseConfig,
    [SCHEDULE_DETERMINISM_META_KEY]: {
      scheduleFingerprint: scheduleInput.scheduleFingerprint,
      scheduleEngineVersion: scheduleInput.scheduleEngineVersion,
      scheduleDefinitionTimezone: scheduleInput.scheduleDefinitionTimezone || scheduleInput.timezone,
      scheduleExecutionTimezone: scheduleInput.scheduleExecutionTimezone || scheduleInput.timezone,
    },
  };
}

function extractScheduleFingerprint(scheduleConfig) {
  if (!scheduleConfig || typeof scheduleConfig !== "object" || Array.isArray(scheduleConfig)) {
    return null;
  }

  const meta = scheduleConfig[SCHEDULE_DETERMINISM_META_KEY];
  if (!meta || typeof meta !== "object") return null;
  return typeof meta.scheduleFingerprint === "string" ? meta.scheduleFingerprint : null;
}

async function assertNoDuplicateRecurringEditSchedule({
  shop,
  scheduleFingerprint,
  excludeRecurringEditId = null,
}) {
  if (!scheduleFingerprint) return;
  const edits = await recurringEditRepository.listByShop(shop);
  const duplicate = edits.find((item) => {
    if (excludeRecurringEditId && item.id === excludeRecurringEditId) return false;
    return extractScheduleFingerprint(item.scheduleConfig) === scheduleFingerprint;
  });

  if (duplicate) {
    const error = new Error("RECURRING_EDIT_SCHEDULE_DUPLICATE");
    error.code = "RECURRING_EDIT_SCHEDULE_DUPLICATE";
    error.duplicateRecurringEditId = duplicate.id;
    throw error;
  }
}

async function getRecurringEditHydrated(id, shop) {
  const edit = await recurringEditRepository.findByIdForShop(id, shop);
  if (!edit) {
    throw new Error("Recurring edit not found");
  }

  const [statusCounts, latestRuns] = await Promise.all([
    recurringEditRunRepository.groupStatusCounts([edit.id]),
    recurringEditRunRepository.findLatestRuns([edit.id]),
  ]);

  const countsById = indexRunCounts(statusCounts);
  const latestRunsById = indexLatestRuns(latestRuns);
  const serialized = serializeRecurringEdit(edit, countsById, latestRunsById);

  const where = productFilterService.getProductPrismaWhere(edit.filterParams, shop);
  const latestHistory = latestRunsById[edit.id]?.editHistoryId
    ? await prisma.editHistory.findFirst({
        where: {
          id: latestRunsById[edit.id].editHistoryId,
          shop,
        },
        select: {
          processedCount: true,
          totalItems: true,
          durationMs: true,
        },
      })
    : null;

  return {
    ...serialized,
    totalItems: latestHistory?.totalItems ?? (await prisma.product.count({ where })),
    processedCount: latestHistory?.processedCount ?? 0,
    durationMs: latestHistory?.durationMs ?? 0,
  };
}

export async function createRecurringEdit({ shop, body, subscription }) {
  validateCanonicalPayloadEnvelope(body || {});

  const filterParams = Array.isArray(body.filterParams) ? body.filterParams : [];
  const rules = buildRulesFromBody(body);
  const rule = validateRules(rules);
  const status = normalizeStatus(body.status, "ACTIVE");

  const scheduleInput = buildRecurringScheduleInput(body);
  await assertNoDuplicateRecurringEditSchedule({
    shop,
    scheduleFingerprint: scheduleInput.scheduleFingerprint,
  });
  const title = String(body.title || "").trim() || buildDefaultTitle(rule);
  const nextRunAt = status === "ACTIVE"
    ? computeRecurringEditNextRunAt({ ...scheduleInput, status }, scheduleInput.startAt || new Date())
    : null;

  const created = await prisma.$transaction(async (tx) => {
    const resolvedSubscription = await assertProRecurringEditAccessForShop({
      shop,
      tx,
    });
    if (status === "ACTIVE") {
      await assertRecurringEditActiveLimit({
        shop,
        tx,
        subscription: resolvedSubscription,
      });
    }

    return recurringEditRepository.create({
      shop,
      title,
      status,
      scheduleType: scheduleInput.scheduleType,
      timezone: scheduleInput.timezone,
      scheduleConfig: withScheduleDeterminismMetadata(
        scheduleInput.scheduleConfig,
        scheduleInput,
      ),
      cronExpression: scheduleInput.cronExpression,
      intervalMinutes: scheduleInput.intervalMinutes,
      startAt: scheduleInput.startAt,
      endAt: scheduleInput.endAt,
      filterParams,
      rules,
      nextRunAt,
    }, tx);
  });

  logger.info("Recurring edit created", {
    shop,
    recurringEditId: created.id,
    scheduleType: created.scheduleType,
    nextRunAt: created.nextRunAt,
  });

  return getRecurringEditHydrated(created.id, shop);
}

export async function listRecurringEdits({ shop }) {
  const edits = await recurringEditRepository.listByShop(shop);
  const ids = edits.map((edit) => edit.id);
  const [statusCounts, latestRuns] = await Promise.all([
    recurringEditRunRepository.groupStatusCounts(ids),
    recurringEditRunRepository.findLatestRuns(ids),
  ]);

  const countsById = indexRunCounts(statusCounts);
  const latestRunsById = indexLatestRuns(latestRuns);

  return edits.map((edit) => serializeRecurringEdit(edit, countsById, latestRunsById));
}

export async function getRecurringEditById({ shop, recurringEditId }) {
  return getRecurringEditHydrated(recurringEditId, shop);
}

export async function updateRecurringEdit({
  shop,
  recurringEditId,
  body,
  subscription,
}) {
  const existing = await recurringEditRepository.findByIdForShop(recurringEditId, shop);
  if (!existing) {
    throw new Error("Recurring edit not found");
  }
  if (body?.canonicalPayload) {
    validateCanonicalPayloadEnvelope(body);
  }

  const mergedBody = {
    ...body,
    scheduleType: body.scheduleType ?? body.frequency ?? existing.scheduleType,
    timezone: body.timezone ?? existing.timezone,
    startAt: body.startAt ?? existing.startAt,
    endAt: body.endAt ?? existing.endAt,
    scheduleConfig: body.scheduleConfig ?? existing.scheduleConfig,
    intervalMinutes: body.intervalMinutes ?? existing.intervalMinutes,
    cronExpression: body.cronExpression ?? existing.cronExpression,
  };

  const nextStatus = normalizeStatus(body.status, existing.status);

  const scheduleInput = buildRecurringScheduleInput(mergedBody, existing);
  await assertNoDuplicateRecurringEditSchedule({
    shop,
    scheduleFingerprint: scheduleInput.scheduleFingerprint,
    excludeRecurringEditId: existing.id,
  });
  const rules = body.rules ? buildRulesFromBody(body) : existing.rules;
  const rule = validateRules(rules);
  const filterParams = Array.isArray(body.filterParams) ? body.filterParams : existing.filterParams;
  const title = body.title !== undefined
    ? String(body.title || "").trim() || buildDefaultTitle(rule)
    : existing.title;
  const nextRunAt = nextStatus === "ACTIVE"
    ? computeRecurringEditNextRunAt({ ...existing, ...scheduleInput, status: nextStatus }, new Date())
    : null;

  await prisma.$transaction(async (tx) => {
    const current = await recurringEditRepository.findByIdForShop(recurringEditId, shop, tx);
    if (!current) {
      throw new Error("Recurring edit not found");
    }

    if (nextStatus === "ACTIVE") {
      const resolvedSubscription = await assertProRecurringEditAccessForShop({
        shop,
        tx,
      });
      if (current.status !== "ACTIVE") {
        await assertRecurringEditActiveLimit({
          shop,
          excludeRecurringEditId: current.id,
          tx,
          subscription: resolvedSubscription,
        });
      }
    }

    await recurringEditRepository.updateById(current.id, {
      title,
      status: nextStatus,
      scheduleType: scheduleInput.scheduleType,
      timezone: scheduleInput.timezone,
      scheduleConfig: withScheduleDeterminismMetadata(
        scheduleInput.scheduleConfig,
        scheduleInput,
      ),
      cronExpression: scheduleInput.cronExpression,
      intervalMinutes: scheduleInput.intervalMinutes,
      startAt: scheduleInput.startAt,
      endAt: scheduleInput.endAt,
      filterParams,
      rules,
      nextRunAt,
      isDeleted: false,
    }, tx);
  });

  return getRecurringEditHydrated(existing.id, shop);
}

export async function toggleRecurringEditStatus({
  shop,
  recurringEditId,
  status,
  subscription,
}) {
  const existing = await recurringEditRepository.findByIdForShop(recurringEditId, shop);
  if (!existing) {
    throw new Error("Recurring edit not found");
  }

  const requestedStatus = normalizeStatus(
    status,
    existing.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
  );

  const nextRunAt = requestedStatus === "ACTIVE"
    ? computeRecurringEditNextRunAt(existing, new Date())
    : null;
  await prisma.$transaction(async (tx) => {
    const current = await recurringEditRepository.findByIdForShop(recurringEditId, shop, tx);
    if (!current) {
      throw new Error("Recurring edit not found");
    }

    if (requestedStatus === "ACTIVE") {
      const resolvedSubscription = await assertProRecurringEditAccessForShop({
        shop,
        tx,
      });
      await assertRecurringEditActiveLimit({
        shop,
        excludeRecurringEditId: current.id,
        tx,
        subscription: resolvedSubscription,
      });
    }

    await recurringEditRepository.updateById(current.id, {
      status: requestedStatus,
      nextRunAt,
    }, tx);
  });

  return getRecurringEditHydrated(existing.id, shop);
}

export async function deleteRecurringEdit({ shop, recurringEditId }) {
  const existing = await recurringEditRepository.findByIdForShop(recurringEditId, shop);
  if (!existing) {
    throw new Error("Recurring edit not found");
  }

  await recurringEditRepository.updateById(existing.id, {
    status: "CANCELLED",
    isDeleted: true,
    nextRunAt: null,
    endAt: existing.endAt || new Date(),
  });

  return {
    id: existing.id,
    deleted: true,
  };
}
