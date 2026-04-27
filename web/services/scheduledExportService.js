import { scheduledExportRepository } from "../repositories/scheduledExportRepository.js";
import { scheduledExportRunRepository } from "../repositories/scheduledExportRunRepository.js";
import { assertScheduledExportAccess } from "./scheduledExportPlanService.js";
import {
  buildScheduledExportScheduleInput,
  computeScheduledExportNextRunAt,
} from "./scheduledExportScheduleService.js";
import logger from "../utils/loggerUtils.js";


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

  return value.endsWith(".csv") ? value : `${value}.csv`;
}

function validateFields(fields = []) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error("fields are required");
  }

  return Array.from(
    new Set(fields.map((field) => String(field).trim()).filter(Boolean)),
  );
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

export async function createScheduledExport({ shop, body, subscription }) {
  await assertScheduledExportAccess(subscription);

  const requestedColumns = validateFields(body.requestedColumns);
  const filename = normalizeFilename(body.filename);
  const filterParams = Array.isArray(body.filterParams) ? body.filterParams : [];
  const status = normalizeStatus(body.status, "ACTIVE");
  const scheduleInput = buildScheduledExportScheduleInput({
    ...body,
  });
  const title = String(body.title || "").trim() || filename.replace(/\.csv$/i, "");
  const nextRunAt =
    status === "ACTIVE"
      ? computeScheduledExportNextRunAt(
          { ...scheduleInput, status, endAt: scheduleInput.endAt },
          new Date(),
        )
      : null;

  if (status === "ACTIVE" && !nextRunAt) {
  console.error("❌ nextRunAt is NULL during creation");
  throw new Error("Scheduled export time must be in the future");
}

  const created = await scheduledExportRepository.create({
    shop,
    title,
    status,
    scheduleType: scheduleInput.scheduleType,
    timezone: scheduleInput.timezone,
    scheduleConfig: scheduleInput.scheduleConfig,
    cronExpression: scheduleInput.cronExpression,
    intervalMinutes: scheduleInput.intervalMinutes,
    startAt: scheduleInput.startAt,
    endAt: scheduleInput.endAt,
    filterParams,
    requestedColumns,
    filename,
    nextRunAt,
  });
console.log("🧪 Creating scheduled export:", {
  status,
  nextRunAt,
  now: new Date().toISOString(),
});

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
}) {
  const existing = await scheduledExportRepository.findByIdForShop(scheduledExportId, shop);
  if (!existing) {
    throw new Error("Scheduled export not found");
  }

  const nextStatus = normalizeStatus(body.status, existing.status);
  if (nextStatus === "ACTIVE") {
    await assertScheduledExportAccess(subscription);
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

  const requestedColumns = body.requestedColumns
    ? validateFields(body.requestedColumns)
    : Array.isArray(existing.requestedColumns)
      ? existing.requestedColumns
      : existing.fields;
  const filename =
    body.filename !== undefined
      ? normalizeFilename(body.filename)
      : existing.filename;
  const filterParams = Array.isArray(body.filterParams)
    ? body.filterParams
    : existing.filterParams;
  const title =
    body.title !== undefined
      ? String(body.title || "").trim() || filename.replace(/\.csv$/i, "")
      : existing.title;
  const nextRunAt =
    nextStatus === "ACTIVE"
      ? computeScheduledExportNextRunAt(
          {
            ...existing,
            ...scheduleInput,
            status: nextStatus,
            endAt: scheduleInput.endAt,
          },
          new Date(),
        )
      : null;

  if (nextStatus === "ACTIVE" && !nextRunAt) {
    throw new Error("Scheduled export time must be in the future");
  }

  await scheduledExportRepository.updateById(existing.id, {
    title,
    status: nextStatus,
    scheduleType: scheduleInput.scheduleType,
    timezone: scheduleInput.timezone,
    scheduleConfig: scheduleInput.scheduleConfig,
    cronExpression: scheduleInput.cronExpression,
    intervalMinutes: scheduleInput.intervalMinutes,
    startAt: scheduleInput.startAt,
    endAt: scheduleInput.endAt,
    filterParams,
    requestedColumns,
    filename,
    nextRunAt,
    isDeleted: false,
  });

  return getScheduledExportHydrated(existing.id, shop);
}

export async function toggleScheduledExportStatus({
  shop,
  scheduledExportId,
  status,
  subscription,
}) {
  const existing = await scheduledExportRepository.findByIdForShop(scheduledExportId, shop);
  if (!existing) {
    throw new Error("Scheduled export not found");
  }

  const requestedStatus = normalizeStatus(
    status,
    existing.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
  );

  if (requestedStatus === "ACTIVE") {
    await assertScheduledExportAccess(subscription);
  }

  const nextRunAt =
    requestedStatus === "ACTIVE"
      ? computeScheduledExportNextRunAt(existing, new Date())
      : null;

  if (requestedStatus === "ACTIVE" && !nextRunAt) {
    throw new Error("Scheduled export time must be in the future");
  }

  await scheduledExportRepository.updateById(existing.id, {
    status: requestedStatus,
    nextRunAt,
  });

  return getScheduledExportHydrated(existing.id, shop);
}

export async function deleteScheduledExport({ shop, scheduledExportId }) {
  const existing = await scheduledExportRepository.findByIdForShop(scheduledExportId, shop);
  if (!existing) {
    throw new Error("Scheduled export not found");
  }

  await scheduledExportRepository.updateById(existing.id, {
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
