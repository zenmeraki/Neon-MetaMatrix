import { DateTime } from "luxon";
import {
  scheduledExportRepository,
  SCHEDULED_EXPORT_STATUS,
} from "../../repositories/scheduledExportRepository.js";
import { exportJobRepository } from "../../repositories/exportJobRepository.js";
import { addProductExportJob } from "../../Jobs/Queues/exportQueue.js";
import {
  freezeTargetSnapshot,
  resolveCanonicalProductTarget,
} from "./productTargetingService.js";

const ALLOWED_FREQUENCIES = new Set([
  "hourly",
  "daily",
  "weekly",
  "monthly",
]);

const SCHEDULED_EXPORT_RETRY_DELAY_MS = 5 * 60 * 1000;

function assertProSubscription(subscription) {
  const planKey = String(subscription?.planKey || "").toUpperCase();
  const planName = String(subscription?.planName || "").trim().toLowerCase();
  const isPro =
    subscription?.isUnlimited === true ||
    subscription?.isPro === true ||
    planKey === "PRO_MONTHLY" ||
    planKey === "PRO" ||
    planKey.startsWith("PRO_") ||
    planName.startsWith("pro");

  if (!isPro) {
    throw new Error("Scheduled exports are available only on the Pro plan");
  }
}

function normalizeFrequency(frequency) {
  const value = String(frequency || "").trim().toLowerCase();

  if (!ALLOWED_FREQUENCIES.has(value)) {
    throw new Error("Invalid scheduled export frequency");
  }

  return value;
}

function computeNextRunAt(frequency, timezone = "UTC", from = new Date()) {
  let dt = DateTime.fromJSDate(from, { zone: timezone });

  if (!dt.isValid) {
    throw new Error("Invalid timezone");
  }

  switch (normalizeFrequency(frequency)) {
    case "hourly":
      dt = dt.plus({ hours: 1 });
      break;
    case "daily":
      dt = dt.plus({ days: 1 });
      break;
    case "weekly":
      dt = dt.plus({ weeks: 1 });
      break;
    case "monthly":
      dt = dt.plus({ months: 1 });
      break;
    default:
      throw new Error("Invalid scheduled export frequency");
  }

  return dt.toUTC().toJSDate();
}

function buildScheduledFileName(name, at = new Date()) {
  const safeName = String(name || "scheduled-export")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_");

  return `${safeName || "scheduled-export"}-${at.getTime()}.csv`;
}

function buildScheduledFileNameTemplate(name) {
  const safeName = String(name || "scheduled-export")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_");

  return `${safeName || "scheduled-export"}.csv`;
}

function buildExportJobFilterQuery(scheduledExport) {
  return JSON.stringify({
    filterParams: Array.isArray(scheduledExport?.filterParams)
      ? scheduledExport.filterParams
      : [],
    queryWhere: scheduledExport?.queryWhere ?? null,
    productIds: Array.isArray(scheduledExport?.productIds)
      ? scheduledExport.productIds
      : [],
  });
}

export class ScheduledExportService {
  constructor(session) {
    this.session = session;
  }

  async createScheduledExport({
    name,
    frequency,
    timezone = "UTC",
    filterParams,
    queryWhere,
    productIds,
    requestedColumns,
    subscription,
  }) {
    assertProSubscription(subscription);

    if (!name?.trim()) throw new Error("Scheduled export name is required");

    const safeFrequency = normalizeFrequency(frequency);

    if (!Array.isArray(requestedColumns) || !requestedColumns.length) {
      throw new Error("At least one export column is required");
    }

    return scheduledExportRepository.create({
      shop: this.session.shop,
      name: name.trim(),
      title: name.trim(),
      type: "PRODUCT_EXPORT",
      frequency: safeFrequency.toUpperCase(),
      timezone,
      filterParams,
      queryWhere,
      productIds,
      requestedColumns,
      filename: buildScheduledFileNameTemplate(name),
      nextRunAt: computeNextRunAt(safeFrequency, timezone),
    });
  }

  async listScheduledExports() {
    return scheduledExportRepository.listByShop(this.session.shop);
  }

  async pauseScheduledExport(id) {
    return scheduledExportRepository.updateStatus({
      id,
      shop: this.session.shop,
      status: SCHEDULED_EXPORT_STATUS.PAUSED,
    });
  }

  async resumeScheduledExport(id) {
    const scheduledExport = await scheduledExportRepository.findByIdForShop(
      id,
      this.session.shop,
    );

    if (!scheduledExport) {
      throw new Error("Scheduled export not found");
    }

    const nextRunAt = computeNextRunAt(
      scheduledExport.frequency,
      scheduledExport.timezone,
      new Date(),
    );

    return scheduledExportRepository.updateByIdForShop(id, this.session.shop, {
      status: SCHEDULED_EXPORT_STATUS.ACTIVE,
      nextRunAt,
      error: null,
    });
  }

  async deleteScheduledExport(id) {
    return scheduledExportRepository.softDelete(id, this.session.shop);
  }

  static async dispatchDueExport({ scheduledExport, lockedBy }) {
    const dispatchTime = new Date();
    const scheduledFor = new Date(scheduledExport.nextRunAt);

    if (!(scheduledFor instanceof Date) || Number.isNaN(scheduledFor.getTime())) {
      throw new Error("Scheduled export is missing a valid nextRunAt");
    }

    const resolvedTarget = await resolveCanonicalProductTarget({
      shop: scheduledExport.shop,
      filterParams: Array.isArray(scheduledExport.filterParams)
        ? scheduledExport.filterParams
        : [],
      explicitWhere: scheduledExport.queryWhere ?? undefined,
      explicitProductIds: Array.isArray(scheduledExport.productIds)
        ? scheduledExport.productIds
        : [],
      queryParams: { page: 1, limit: 20 },
      sampleLimit: 20,
    });

    const exportFileName = buildScheduledFileName(
      scheduledExport.name || scheduledExport.title,
      dispatchTime,
    );

    const exportJob = await exportJobRepository.create({
      shop: scheduledExport.shop,
      executionKey: `scheduled-export:${scheduledExport.shop}:${scheduledExport.id}:${scheduledFor.toISOString()}`,
      type: scheduledExport.type ?? "PRODUCT_EXPORT",
      status: "PENDING",
      executionState: "planned",
      filterQuery: buildExportJobFilterQuery(scheduledExport),
      targetMirrorBatchId: resolvedTarget.mirrorBatchId ?? null,
      filename: exportFileName,
      fields: Array.isArray(scheduledExport.requestedColumns)
        ? scheduledExport.requestedColumns
        : Array.isArray(scheduledExport.fields)
          ? scheduledExport.fields
          : [],
      mimeType: "text/csv",
      isScheduled: true,
      scheduledExportId: scheduledExport.id,
      triggerType: "SCHEDULED",
    });

    let frozenCount;
    try {
      frozenCount = await freezeTargetSnapshot({
        ownerType: "EXPORT_JOB",
        ownerId: exportJob.id,
        shop: scheduledExport.shop,
        where: resolvedTarget.where,
        mirrorBatchId: resolvedTarget.mirrorBatchId,
      });
    } catch (error) {
      await exportJobRepository.markFailedBeforeQueue({
        id: exportJob.id,
        shop: scheduledExport.shop,
        error: new Error(`Scheduled export freeze failed: ${error.message}`),
        failureStage: "freeze_target_snapshot",
        now: new Date(),
      });
      throw error;
    }

    const queuedTransition = await exportJobRepository.markQueued({
      id: exportJob.id,
      shop: scheduledExport.shop,
      targetSnapshotCount: frozenCount,
      now: new Date(),
    });

    if (!queuedTransition.count) {
      await exportJobRepository.markFailedBeforeQueue({
        id: exportJob.id,
        shop: scheduledExport.shop,
        error: new Error("Scheduled export job could not transition to queued"),
        failureStage: "queue_state_transition",
        now: new Date(),
      });
      throw new Error("Scheduled export job could not transition to queued");
    }

    try {
      await addProductExportJob(
        {
          exportJobId: exportJob.id,
          shop: scheduledExport.shop,
          fields: exportJob.fields,
          scheduledExportId: scheduledExport.id,
          executionId: exportJob.id,
        },
        {
          jobId: `scheduled-export:${scheduledExport.shop}:${scheduledExport.id}:${exportJob.id}`,
        },
      );
    } catch (error) {
      await exportJobRepository.markFailedBeforeQueue({
        id: exportJob.id,
        shop: scheduledExport.shop,
        error: new Error(`Scheduled export enqueue failed: ${error.message}`),
        failureStage: "enqueue_export_job",
        now: new Date(),
      });
      throw error;
    }

    const nextRunAt = computeNextRunAt(
      scheduledExport.frequency,
      scheduledExport.timezone,
      scheduledFor,
    );

    await scheduledExportRepository.markRunQueued({
      id: scheduledExport.id,
      exportJobId: exportJob.id,
      nextRunAt,
      lockedBy,
      now: dispatchTime,
    });

    return exportJob;
  }

  static computeRetryRunAt(from = new Date()) {
    return new Date(from.getTime() + SCHEDULED_EXPORT_RETRY_DELAY_MS);
  }
}

export { computeNextRunAt, assertProSubscription };
