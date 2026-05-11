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
  lockVersion: true,
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

function assertLockedBy(lockedBy) {
  if (!lockedBy || !String(lockedBy).trim()) {
    throw new Error("lockedBy is required");
  }
}

function assertExpectedLockVersion(expectedLockVersion) {
  if (!Number.isInteger(Number(expectedLockVersion)) || Number(expectedLockVersion) < 0) {
    throw new Error("expectedLockVersion is required");
  }
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
        status: data.status ?? SCHEDULED_EXPORT_STATUS.ACTIVE,
        frequency: data.frequency ?? null,
        scheduleType: data.scheduleType,
        timezone: data.timezone || "UTC",
        scheduleConfig: data.scheduleConfig,
        cronExpression: data.cronExpression ?? null,
        intervalMinutes: data.intervalMinutes ?? null,
        startAt: data.startAt ?? null,
        endAt: data.endAt ?? null,
        filterParams: data.filterParams ?? [],
        queryWhere: data.queryWhere ?? null,
        productIds: data.productIds ?? null,
        requestedColumns: data.requestedColumns ?? [],
        fields: Array.isArray(data.fields)
          ? data.fields
          : Array.isArray(data.requestedColumns)
            ? data.requestedColumns
            : [],
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

  async countActiveByShop(shop, excludeId = null, db = prisma) {
    assertShop(shop);
    return getClient(db).scheduledExport.count({
      where: {
        shop,
        isDeleted: false,
        status: SCHEDULED_EXPORT_STATUS.ACTIVE,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
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
    // Internal only. Use updateByIdForShop for application paths.
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

  async updateByIdForShopWithUpdatedAt(
    { id, shop, expectedUpdatedAt, data },
    db = prisma,
  ) {
    assertShop(shop);
    if (!expectedUpdatedAt) {
      throw new Error("expectedUpdatedAt is required");
    }

    return getClient(db).scheduledExport.updateMany({
      where: {
        id,
        shop,
        isDeleted: false,
        updatedAt: new Date(expectedUpdatedAt),
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

  async findDueScheduledExportIds({ shop = null, now, limit = 100 }, db = prisma) {
    if (shop) assertShop(shop);
    return getClient(db).scheduledExport.findMany({
      where: {
        ...(shop ? { shop } : {}),
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
      orderBy: [{ nextRunAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: limit,
    });
  },

  async acquireLock(
    { id, shop, lockedBy, now = new Date(), expectedLockVersion = null },
    db = prisma,
  ) {
    assertShop(shop);
    assertLockedBy(lockedBy);
    if (expectedLockVersion !== null) assertExpectedLockVersion(expectedLockVersion);

    return getClient(db).scheduledExport.updateMany({
      where: {
        id,
        shop,
        isDeleted: false,
        status: SCHEDULED_EXPORT_STATUS.ACTIVE,
        nextRunAt: {
          lte: now,
        },
        ...(expectedLockVersion !== null
          ? { lockVersion: BigInt(Number(expectedLockVersion)) }
          : {}),
        OR: [{ lockedBy }, ...activeOrExpiredLockWhere(now).OR],
      },
      data: {
        lockedAt: now,
        lockedBy,
        lockVersion: {
          increment: 1,
        },
      },
    });
  },

  async markRunQueued(
    { id, shop, exportJobId, nextRunAt, lockedBy, now = new Date(), expectedLockVersion = null },
    db = prisma,
  ) {
    assertShop(shop);
    assertLockedBy(lockedBy);
    if (expectedLockVersion !== null) assertExpectedLockVersion(expectedLockVersion);

    if (nextRunAt && new Date(nextRunAt).getTime() <= now.getTime()) {
      throw new Error("nextRunAt must be greater than now");
    }

    return getClient(db).scheduledExport.updateMany({
      where: {
        id,
        shop,
        isDeleted: false,
        status: SCHEDULED_EXPORT_STATUS.ACTIVE,
        lockedBy,
        lockedAt: {
          gte: getStaleLockCutoff(now),
        },
        ...(expectedLockVersion !== null
          ? { lockVersion: BigInt(Number(expectedLockVersion)) }
          : {}),
      },
      data: {
        lastRunAt: now,
        nextRunAt,
        ...(exportJobId ? { lastExportJobId: exportJobId } : {}),
        lockedAt: null,
        lockedBy: null,
        error: null,
      },
    });
  },

  async extendLock(
    { id, shop, lockedBy, now = new Date(), expectedLockVersion = null },
    db = prisma,
  ) {
    assertShop(shop);
    assertLockedBy(lockedBy);
    if (expectedLockVersion !== null) assertExpectedLockVersion(expectedLockVersion);

    return getClient(db).scheduledExport.updateMany({
      where: {
        id,
        shop,
        lockedBy,
        lockedAt: {
          gte: getStaleLockCutoff(now),
        },
        ...(expectedLockVersion !== null
          ? { lockVersion: BigInt(Number(expectedLockVersion)) }
          : {}),
      },
      data: {
        lockedAt: now,
      },
    });
  },

  async releaseLockIfOwned(
    { id, shop, lockedBy, expectedLockVersion = null },
    db = prisma,
  ) {
    assertShop(shop);
    assertLockedBy(lockedBy);
    if (expectedLockVersion !== null) assertExpectedLockVersion(expectedLockVersion);

    return getClient(db).scheduledExport.updateMany({
      where: {
        id,
        shop,
        lockedBy,
        ...(expectedLockVersion !== null
          ? { lockVersion: BigInt(Number(expectedLockVersion)) }
          : {}),
      },
      data: {
        lockedAt: null,
        lockedBy: null,
      },
    });
  },

  async claimDueScheduledExports(
    { now = new Date(), limit = 100, lockedBy, shop = null },
    db = prisma,
  ) {
    assertLockedBy(lockedBy);
    if (shop) assertShop(shop);

    return getClient(db).$transaction(async (tx) => {
      if (shop) {
        const rows = await tx.$queryRaw`
          WITH due AS (
            SELECT "id"
            FROM "ScheduledExport"
            WHERE "isDeleted" = false
              AND "status" = 'ACTIVE'
              AND "nextRunAt" IS NOT NULL
              AND "nextRunAt" <= ${now}
              AND (
                "lockedAt" IS NULL
                OR "lockedAt" < ${getStaleLockCutoff(now)}
              )
              AND "shop" = ${shop}
            ORDER BY "nextRunAt" ASC, "createdAt" ASC, "id" ASC
            FOR UPDATE SKIP LOCKED
            LIMIT ${limit}
          )
          UPDATE "ScheduledExport" se
          SET "lockedAt" = ${now},
              "lockedBy" = ${lockedBy},
              "lockVersion" = se."lockVersion" + 1,
              "updatedAt" = ${now}
          FROM due
          WHERE se."id" = due."id"
          RETURNING se."id", se."shop", se."nextRunAt", se."lockVersion";
        `;

        return rows || [];
      }

      const rows = await tx.$queryRaw`
        WITH due AS (
          SELECT "id"
          FROM "ScheduledExport"
          WHERE "isDeleted" = false
            AND "status" = 'ACTIVE'
            AND "nextRunAt" IS NOT NULL
            AND "nextRunAt" <= ${now}
            AND (
              "lockedAt" IS NULL
              OR "lockedAt" < ${getStaleLockCutoff(now)}
            )
          ORDER BY "nextRunAt" ASC, "createdAt" ASC, "id" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE "ScheduledExport" se
        SET "lockedAt" = ${now},
            "lockedBy" = ${lockedBy},
            "lockVersion" = se."lockVersion" + 1,
            "updatedAt" = ${now}
        FROM due
        WHERE se."id" = due."id"
        RETURNING se."id", se."shop", se."nextRunAt", se."lockVersion";
      `;

      return rows || [];
    });
  },

};

export { SCHEDULED_EXPORT_STATUS, STALE_LOCK_WINDOW_MS };
