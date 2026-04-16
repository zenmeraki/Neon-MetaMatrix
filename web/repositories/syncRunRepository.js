import { prisma } from "../Config/database.js";

/**
 * SyncRun repository.
 *
 * Responsibilities:
 * - Prisma access only
 * - no Shopify API calls
 * - no orchestration logic
 * - no controller concerns
 *
 * Expected Prisma model:
 *   model SyncRun { ... }
 *
 * Do not use this repository until the SyncRun model exists in prisma.schema
 * and the migration has been applied.
 */

const DEFAULT_SELECT = {
  id: true,
  shop: true,
  runType: true,
  domain: true,
  status: true,
  stage: true,
  catalogBatchId: true,
  bulkOperationId: true,
  triggerSource: true,
  responseUrl: true,
  rowCount: true,
  durationMs: true,
  isInitialSync: true,
  failureCode: true,
  failureMessage: true,
  startedAt: true,
  completedAt: true,
  lastHeartbeatAt: true,
  createdAt: true,
  updatedAt: true,
};

const assertShop = (shop) => {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required");
  }
};

const assertId = (id, fieldName = "id") => {
  if (!id || typeof id !== "string") {
    throw new Error(`${fieldName} is required`);
  }
};

const buildSelect = (select) => select || DEFAULT_SELECT;

/**
 * Create a SyncRun row.
 */
export const createSyncRun = async (data, options = {}) => {
  if (!data || typeof data !== "object") {
    throw new Error("data is required");
  }

  assertShop(data.shop);

  if (!data.runType) {
    throw new Error("runType is required");
  }

  return prisma.syncRun.create({
    data,
    select: buildSelect(options.select),
  });
};

/**
 * Update a SyncRun row by id.
 */
export const updateSyncRun = async (id, data, options = {}) => {
  assertId(id, "syncRun id");

  if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
    throw new Error("update data is required");
  }

  return prisma.syncRun.update({
    where: { id },
    data,
    select: buildSelect(options.select),
  });
};

/**
 * Find a SyncRun by id.
 */
export const findSyncRunById = async (id, options = {}) => {
  assertId(id, "syncRun id");

  return prisma.syncRun.findUnique({
    where: { id },
    select: buildSelect(options.select),
  });
};

/**
 * Find the latest SyncRun by Shopify bulk operation id.
 */
export const findSyncRunByBulkOperationId = async (
  bulkOperationId,
  options = {},
) => {
  assertId(bulkOperationId, "bulkOperationId");

  return prisma.syncRun.findFirst({
    where: { bulkOperationId },
    orderBy: { createdAt: "desc" },
    select: buildSelect(options.select),
  });
};

/**
 * Find the latest SyncRun for a shop.
 *
 * Optional filters:
 * - runType
 * - domain
 * - status
 */
export const findLatestSyncRunByShop = async (
  shop,
  filters = {},
  options = {},
) => {
  assertShop(shop);

  const where = {
    shop,
    ...(filters.runType ? { runType: filters.runType } : {}),
    ...(filters.domain ? { domain: filters.domain } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };

  return prisma.syncRun.findFirst({
    where,
    orderBy: { createdAt: "desc" },
    select: buildSelect(options.select),
  });
};

/**
 * Find the latest completed SyncRun for a shop.
 */
export const findLatestCompletedSyncRunByShop = async (
  shop,
  filters = {},
  options = {},
) => {
  return findLatestSyncRunByShop(
    shop,
    {
      ...filters,
      status: "COMPLETED",
    },
    options,
  );
};

/**
 * Find currently running sync runs for a shop.
 *
 * Transitional implementation:
 * We treat PENDING and RUNNING as active execution states.
 * Later, you can tighten this once your SyncRun state machine is fully enforced.
 */
export const findActiveSyncRunsByShop = async (
  shop,
  filters = {},
  options = {},
) => {
  assertShop(shop);

  const where = {
    shop,
    status: {
      in: ["PENDING", "RUNNING"],
    },
    ...(filters.runType ? { runType: filters.runType } : {}),
    ...(filters.domain ? { domain: filters.domain } : {}),
  };

  return prisma.syncRun.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    select: buildSelect(options.select),
  });
};

/**
 * Find the most recent active sync run for a shop.
 */
export const findLatestActiveSyncRunByShop = async (
  shop,
  filters = {},
  options = {},
) => {
  const runs = await findActiveSyncRunsByShop(shop, filters, {
    select: buildSelect(options.select),
  });

  return runs[0] || null;
};

/**
 * Heartbeat a SyncRun row.
 *
 * Useful for workers / long-running orchestration loops.
 */
export const heartbeatSyncRun = async (id, options = {}) => {
  assertId(id, "syncRun id");

  return prisma.syncRun.update({
    where: { id },
    data: {
      lastHeartbeatAt: new Date(),
    },
    select: buildSelect(options.select),
  });
};

/**
 * Mark a SyncRun as running.
 */
export const markSyncRunRunning = async (
  id,
  data = {},
  options = {},
) => {
  assertId(id, "syncRun id");

  return prisma.syncRun.update({
    where: { id },
    data: {
      status: "RUNNING",
      startedAt: data.startedAt || new Date(),
      ...(data.stage ? { stage: data.stage } : {}),
      ...(data.bulkOperationId ? { bulkOperationId: data.bulkOperationId } : {}),
      ...(data.catalogBatchId ? { catalogBatchId: data.catalogBatchId } : {}),
      ...(data.triggerSource ? { triggerSource: data.triggerSource } : {}),
      ...(data.responseUrl ? { responseUrl: data.responseUrl } : {}),
      lastHeartbeatAt: new Date(),
    },
    select: buildSelect(options.select),
  });
};

/**
 * Mark a SyncRun as completed.
 */
export const markSyncRunCompleted = async (
  id,
  data = {},
  options = {},
) => {
  assertId(id, "syncRun id");

  return prisma.syncRun.update({
    where: { id },
    data: {
      status: "COMPLETED",
      stage: data.stage || "COMPLETED",
      completedAt: data.completedAt || new Date(),
      ...(typeof data.rowCount === "number" ? { rowCount: data.rowCount } : {}),
      ...(typeof data.durationMs === "number"
        ? { durationMs: data.durationMs }
        : {}),
      ...(data.catalogBatchId ? { catalogBatchId: data.catalogBatchId } : {}),
      ...(data.responseUrl ? { responseUrl: data.responseUrl } : {}),
      ...(data.bulkOperationId ? { bulkOperationId: data.bulkOperationId } : {}),
      failureCode: null,
      failureMessage: null,
      lastHeartbeatAt: new Date(),
    },
    select: buildSelect(options.select),
  });
};

/**
 * Mark a SyncRun as failed.
 */
export const markSyncRunFailed = async (
  id,
  data = {},
  options = {},
) => {
  assertId(id, "syncRun id");

  return prisma.syncRun.update({
    where: { id },
    data: {
      status: "FAILED",
      stage: data.stage || "FAILED",
      completedAt: data.completedAt || new Date(),
      failureCode: data.failureCode || null,
      failureMessage: data.failureMessage || "Sync failed",
      ...(typeof data.durationMs === "number"
        ? { durationMs: data.durationMs }
        : {}),
      ...(data.bulkOperationId ? { bulkOperationId: data.bulkOperationId } : {}),
      ...(data.responseUrl ? { responseUrl: data.responseUrl } : {}),
      lastHeartbeatAt: new Date(),
    },
    select: buildSelect(options.select),
  });
};

/**
 * Mark a SyncRun as cancelled.
 */
export const markSyncRunCancelled = async (
  id,
  data = {},
  options = {},
) => {
  assertId(id, "syncRun id");

  return prisma.syncRun.update({
    where: { id },
    data: {
      status: "CANCELLED",
      stage: data.stage || "FAILED",
      completedAt: data.completedAt || new Date(),
      failureCode: data.failureCode || null,
      failureMessage: data.failureMessage || "Sync cancelled",
      lastHeartbeatAt: new Date(),
    },
    select: buildSelect(options.select),
  });
};

/**
 * List recent sync runs for a shop.
 */
export const listRecentSyncRunsByShop = async (
  shop,
  filters = {},
  options = {},
) => {
  assertShop(shop);

  const take =
    typeof options.take === "number" && options.take > 0
      ? Math.min(options.take, 100)
      : 20;

  const where = {
    shop,
    ...(filters.runType ? { runType: filters.runType } : {}),
    ...(filters.domain ? { domain: filters.domain } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };

  return prisma.syncRun.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take,
    select: buildSelect(options.select),
  });
};
