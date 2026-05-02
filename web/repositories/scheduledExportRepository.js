import { prisma } from "../config/database.js";

const SCHEDULED_EXPORT_STATUS = {
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  DELETED: "DELETED",
};

const STALE_LOCK_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_LIST_TAKE = 100;
const LIST_SELECT = {
  id: true,
  shop: true,
  title: true,
  name: true,
  type: true,
  status: true,
  frequency: true,
  scheduleType: true,
  timezone: true,
  scheduleConfig: true,
  cronExpression: true,
  intervalMinutes: true,
  startAt: true,
  endAt: true,
  filterParams: true,
  queryWhere: true,
  productIds: true,
  requestedColumns: true,
  fields: true,
  filename: true,
  nextRunAt: true,
  lastRunAt: true,
  lockedAt: true,
  lockedBy: true,
  lastExportJobId: true,
  error: true,
  runCount: true,
  lastSuccessAt: true,
  lastFailureAt: true,
  lastFailureReason: true,
  createdAt: true,
  updatedAt: true,
};

function getClient(db) {
  return db || prisma;
}

function assertShop(shop) {
  if (!shop) throw new Error("shop is required");
}

function getStaleLockCutoff(now = new Date()) {
  return new Date(now.getTime() - STALE_LOCK_WINDOW_MS);
}

function activeOrExpiredLockWhere(now = new Date()) {
  return {
    OR: [
      { lockedAt: null },
      {
        lockedAt: {
          lt: getStaleLockCutoff(now),
        },
      },
    ],
  };
}

function normalizeListArgs(shopOrArgs, maybeDb) {
  if (typeof shopOrArgs === "string") {
    return {
      shop: shopOrArgs,
      take: DEFAULT_LIST_TAKE,
      db: maybeDb ?? prisma,
    };
  }

  return {
    shop: shopOrArgs?.shop,
    take:
      Number.isInteger(shopOrArgs?.take) && shopOrArgs.take > 0
        ? shopOrArgs.take
        : DEFAULT_LIST_TAKE,
    db: maybeDb ?? shopOrArgs?.db ?? prisma,
  };
}

export const scheduledExportRepository = {
  async create(data, db = prisma) {
    assertShop(data.shop);

    return getClient(db).scheduledExport.create({
      data: {
        shop: data.shop,
        title: data.title ?? data.name,
        name: data.name ?? data.title ?? null,
        type: data.type || "PRODUCT_EXPORT",
        status: SCHEDULED_EXPORT_STATUS.ACTIVE,
        frequency: data.frequency ?? null,
        scheduleType: data.scheduleType,
        timezone: data.timezone || "UTC",
        scheduleConfig: data.scheduleConfig,
        cronExpression: data.cronExpression ?? null,
        intervalMinutes: data.intervalMinutes ?? null,
        startAt: data.startAt ?? null,
        endAt: data.endAt ?? null,
        filterParams: data.filterParams ?? null,
        queryWhere: data.queryWhere ?? null,
        productIds: data.productIds ?? null,
        requestedColumns: data.requestedColumns ?? [],
        filename: data.filename ?? `${data.name || data.title || "export"}.csv`,
        nextRunAt: data.nextRunAt,
        error: null,
        isDeleted: false,
      },
    });
  },

  async findById(id, db = prisma) {
    return getClient(db).scheduledExport.findUnique({
      where: { id },
    });
  },

  async listByShop(shopOrArgs, db = prisma) {
    const { shop, take, db: resolvedDb } = normalizeListArgs(shopOrArgs, db);
    assertShop(shop);

    return getClient(resolvedDb).scheduledExport.findMany({
      where: {
        shop,
        isDeleted: false,
      },
      select: LIST_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
    });
  },

  async findByIdForShop(id, shop, db = prisma) {
    assertShop(shop);

    return getClient(db).scheduledExport.findFirst({
      where: {
        id,
        shop,
        isDeleted: false,
      },
    });
  },

  async updateById(id, data, db = prisma) {
    return getClient(db).scheduledExport.update({
      where: { id },
      data,
    });
  },

  async updateByIdForShop(id, shop, data, db = prisma) {
    assertShop(shop);

    return getClient(db).scheduledExport.updateMany({
      where: {
        id,
        shop,
        isDeleted: false,
      },
      data,
    });
  },

  async softDelete(id, shop, db = prisma) {
    assertShop(shop);

    return getClient(db).scheduledExport.updateMany({
      where: {
        id,
        shop,
        isDeleted: false,
      },
      data: {
        isDeleted: true,
        status: SCHEDULED_EXPORT_STATUS.PAUSED,
        lockedAt: null,
        lockedBy: null,
        nextRunAt: null,
      },
    });
  },

  async updateStatus({ id, shop, status }, db = prisma) {
    assertShop(shop);

    return getClient(db).scheduledExport.updateMany({
      where: {
        id,
        shop,
        isDeleted: false,
      },
      data: {
        status,
      },
    });
  },

  async findDueScheduledExportIds(now, limit = 100, db = prisma) {
    return getClient(db).scheduledExport.findMany({
      where: {
        isDeleted: false,
        status: SCHEDULED_EXPORT_STATUS.ACTIVE,
        nextRunAt: {
          lte: now,
        },
        ...activeOrExpiredLockWhere(now),
      },
      select: {
        id: true,
      },
      orderBy: [{ nextRunAt: "asc" }, { createdAt: "asc" }],
      take: limit,
    });
  },

  async findDueExports({ now = new Date(), take = 25 }, db = prisma) {
    return getClient(db).scheduledExport.findMany({
      where: {
        isDeleted: false,
        status: SCHEDULED_EXPORT_STATUS.ACTIVE,
        nextRunAt: {
          lte: now,
        },
        ...activeOrExpiredLockWhere(now),
      },
      orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
      take,
    });
  },

  async acquireLock({ id, lockedBy, now = new Date() }, db = prisma) {
    return getClient(db).scheduledExport.updateMany({
      where: {
        id,
        isDeleted: false,
        status: SCHEDULED_EXPORT_STATUS.ACTIVE,
        nextRunAt: {
          lte: now,
        },
        ...activeOrExpiredLockWhere(now),
      },
      data: {
        lockedAt: now,
        lockedBy,
      },
    });
  },

  async acquireLocks({ ids = [], lockedBy, now = new Date() }, db = prisma) {
    const safeIds = Array.isArray(ids) ? [...new Set(ids.filter(Boolean))] : [];

    if (!safeIds.length) {
      return { count: 0, lockedAt: now };
    }

    const result = await getClient(db).scheduledExport.updateMany({
      where: {
        id: { in: safeIds },
        isDeleted: false,
        status: SCHEDULED_EXPORT_STATUS.ACTIVE,
        nextRunAt: {
          lte: now,
        },
        ...activeOrExpiredLockWhere(now),
      },
      data: {
        lockedAt: now,
        lockedBy,
      },
    });

    return {
      ...result,
      lockedAt: now,
    };
  },

  async findLockedByIds(
    { ids = [], lockedBy, lockedAt },
    db = prisma,
  ) {
    const safeIds = Array.isArray(ids) ? [...new Set(ids.filter(Boolean))] : [];

    if (!safeIds.length || !lockedBy || !lockedAt) {
      return [];
    }

    return getClient(db).scheduledExport.findMany({
      where: {
        id: { in: safeIds },
        isDeleted: false,
        status: SCHEDULED_EXPORT_STATUS.ACTIVE,
        lockedBy,
        lockedAt,
      },
      orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
    });
  },

  async markRunQueued(
    { id, exportJobId, nextRunAt, lockedBy, now = new Date() },
    db = prisma,
  ) {
    return getClient(db).scheduledExport.updateMany({
      where: {
        id,
        isDeleted: false,
        status: SCHEDULED_EXPORT_STATUS.ACTIVE,
        ...(lockedBy ? { lockedBy } : {}),
      },
      data: {
        lastRunAt: now,
        nextRunAt,
        lastExportJobId: exportJobId,
        lockedAt: null,
        lockedBy: null,
        error: null,
      },
    });
  },

  async markFailed(
    { id, error, lockedBy, nextRunAt = null },
    db = prisma,
  ) {
    return getClient(db).scheduledExport.updateMany({
      where: {
        id,
        isDeleted: false,
        status: SCHEDULED_EXPORT_STATUS.ACTIVE,
        ...(lockedBy ? { lockedBy } : {}),
      },
      data: {
        lockedAt: null,
        lockedBy: null,
        nextRunAt,
        error: error?.message || String(error || "Scheduled export failed"),
      },
    });
  },
};

export { SCHEDULED_EXPORT_STATUS, STALE_LOCK_WINDOW_MS };
