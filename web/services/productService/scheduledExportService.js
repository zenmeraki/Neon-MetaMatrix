import { DateTime } from "luxon";
import {
  scheduledExportRepository,
  SCHEDULED_EXPORT_STATUS,
} from "../../repositories/scheduledExportRepository.js";

const ALLOWED_FREQUENCIES = new Set([
  "hourly",
  "daily",
  "weekly",
  "monthly",
]);

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

function buildScheduledFileNameTemplate(name) {
  const safeName = String(name || "scheduled-export")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_");

  return `${safeName || "scheduled-export"}.csv`;
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
}

export { computeNextRunAt, assertProSubscription };
