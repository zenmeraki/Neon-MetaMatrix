import { prisma } from "../config/database.js";

const DEFAULT_QUERY_LIMIT = 100;
const MAX_QUERY_LIMIT = 250;
const ACTIVE_EDIT_COUNT_GUARD = 21;
const DEFAULT_CLAIM_LEASE_MS = 2 * 60 * 1000;
const STATUSES = new Set(["ACTIVE", "PAUSED", "COMPLETED", "FAILED", "CANCELLED"]);
const SCHEDULE_TYPES = new Set(["ONE_TIME", "CRON", "DAILY", "WEEKLY", "MONTHLY", "EVERY_X_MINUTES"]);
const MIN_RECURRING_INTERVAL_MINUTES = 5;

function getClient(db) {
  return db || prisma;
}

function assertShop(shop) {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required for recurring edit repository access");
  }
}

function assertDate(value, fieldName) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${fieldName} must be a valid Date`);
  }
}

function normalizeLimit(limit, defaultLimit = DEFAULT_QUERY_LIMIT) {
  const parsed = Number.parseInt(limit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultLimit;
  return Math.min(parsed, MAX_QUERY_LIMIT);
}

function claimExpiresAt(now, leaseMs = DEFAULT_CLAIM_LEASE_MS) {
  assertDate(now, "now");
  return new Date(now.getTime() + leaseMs);
}

function validateRecurringEditWrite(data = {}) {
  if (data.status !== undefined && !STATUSES.has(data.status)) {
    throw new Error("Invalid recurring edit status");
  }

  if (data.scheduleType !== undefined && !SCHEDULE_TYPES.has(data.scheduleType)) {
    throw new Error("Invalid recurring edit scheduleType");
  }

  if (
    data.scheduleType === "EVERY_X_MINUTES" &&
    Number.isInteger(data.intervalMinutes) &&
    data.intervalMinutes < MIN_RECURRING_INTERVAL_MINUTES
  ) {
    throw new Error(
      `Recurring edit interval must be at least ${MIN_RECURRING_INTERVAL_MINUTES} minutes`,
    );
  }

  if (data.status === "ACTIVE" && !data.scheduleType) {
    throw new Error("Active recurring edits require a scheduleType");
  }
}

export const recurringEditRepository = {
  async create(data, db = prisma) {
    assertShop(data?.shop);
    validateRecurringEditWrite(data);
    return getClient(db).recurringEdit.create({ data });
  },

  async findById(id, shop, db = prisma) {
    assertShop(shop);
    return getClient(db).recurringEdit.findFirst({
      where: { id, shop, isDeleted: false },
    });
  },

  async findByIdForShop(id, shop, db = prisma) {
    return this.findById(id, shop, db);
  },

  async listByShop(shopOrArgs, db = prisma) {
    const args = typeof shopOrArgs === "string" ? { shop: shopOrArgs } : shopOrArgs || {};
    const { shop, cursorId = null, select = null } = args;
    const limit = normalizeLimit(args.limit);
    assertShop(shop);

    return getClient(db).recurringEdit.findMany({
      where: {
        shop,
        isDeleted: false,
        ...(cursorId ? { id: { lt: cursorId } } : {}),
      },
      ...(select ? { select } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
  },

  async updateById(id, shop, data, db = prisma) {
    assertShop(shop);
    validateRecurringEditWrite(data);
    return getClient(db).recurringEdit.updateMany({
      where: { id, shop, isDeleted: false },
      data,
    });
  },

  async countActiveByShop(shop, excludeId = null, db = prisma) {
    assertShop(shop);
    const rows = await getClient(db).recurringEdit.findMany({
      where: {
        shop,
        isDeleted: false,
        status: "ACTIVE",
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
      take: ACTIVE_EDIT_COUNT_GUARD,
    });
    return rows.length;
  },

  async findDueShops(now, limit = DEFAULT_QUERY_LIMIT, db = prisma) {
    assertDate(now, "now");
    const rows = await getClient(db).recurringEdit.findMany({
      where: {
        isDeleted: false,
        status: "ACTIVE",
        nextRunAt: { lte: now },
        OR: [
          { lockExpiresAt: null },
          { lockExpiresAt: { lt: now } },
        ],
      },
      select: { shop: true },
      distinct: ["shop"],
      orderBy: [{ shop: "asc" }],
      take: normalizeLimit(limit),
    });
    return rows.map((row) => row.shop);
  },

  async findDueRecurringEditIds({ shop, now, limit = DEFAULT_QUERY_LIMIT, cursorId = null }, db = prisma) {
    assertShop(shop);
    assertDate(now, "now");
    return getClient(db).recurringEdit.findMany({
      where: {
        shop,
        isDeleted: false,
        status: "ACTIVE",
        nextRunAt: { lte: now },
        OR: [
          { lockExpiresAt: null },
          { lockExpiresAt: { lt: now } },
        ],
        ...(cursorId ? { id: { gt: cursorId } } : {}),
      },
      select: {
        id: true,
        shop: true,
      },
      orderBy: [{ nextRunAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: normalizeLimit(limit),
    });
  },

  async claimDueRecurringEdit(
    { id, shop, now, worker, leaseMs = DEFAULT_CLAIM_LEASE_MS },
    db = prisma,
  ) {
    assertShop(shop);
    assertDate(now, "now");
    if (!worker) throw new Error("worker is required to claim recurring edit");

    const transition = await getClient(db).recurringEdit.updateMany({
      where: {
        id,
        shop,
        isDeleted: false,
        status: "ACTIVE",
        nextRunAt: { lte: now },
        OR: [
          { lockExpiresAt: null },
          { lockExpiresAt: { lt: now } },
          { lockedBy: worker },
        ],
      },
      data: {
        lockedAt: now,
        lockedBy: worker,
        lockExpiresAt: claimExpiresAt(now, leaseMs),
      },
    });

    if (transition.count !== 1) return null;
    return this.findById(id, shop, db);
  },

  async releaseClaim({ id, shop, worker }, db = prisma) {
    assertShop(shop);
    if (!worker) throw new Error("worker is required to release recurring edit claim");

    return getClient(db).recurringEdit.updateMany({
      where: {
        id,
        shop,
        lockedBy: worker,
      },
      data: {
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null,
      },
    });
  },

  async releaseExpiredClaims({ shop, now, limit = DEFAULT_QUERY_LIMIT }, db = prisma) {
    assertShop(shop);
    assertDate(now, "now");

    const expired = await getClient(db).recurringEdit.findMany({
      where: {
        shop,
        lockedBy: { not: null },
        lockExpiresAt: { lt: now },
      },
      select: { id: true },
      take: normalizeLimit(limit),
      orderBy: [{ lockExpiresAt: "asc" }, { id: "asc" }],
    });

    if (!expired.length) return { count: 0 };

    return getClient(db).recurringEdit.updateMany({
      where: {
        shop,
        id: { in: expired.map((row) => row.id) },
        lockExpiresAt: { lt: now },
      },
      data: {
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null,
      },
    });
  },

  async recordDispatch(
    { id, shop, worker, runId, nextRunAt, now, status = nextRunAt ? "ACTIVE" : "COMPLETED" },
    db = prisma,
  ) {
    assertShop(shop);
    assertDate(now, "now");
    if (!worker) throw new Error("worker is required to record recurring edit dispatch");
    if (!runId) throw new Error("runId is required to record recurring edit dispatch");
    validateRecurringEditWrite({ status });

    return getClient(db).recurringEdit.updateMany({
      where: {
        id,
        shop,
        isDeleted: false,
        lockedBy: worker,
      },
      data: {
        nextRunAt,
        status,
        lastRunId: runId,
        lastRunAt: now,
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null,
      },
    });
  },

  async softDeleteById(id, shop, data = {}, db = prisma) {
    assertShop(shop);
    return getClient(db).recurringEdit.updateMany({
      where: {
        id,
        shop,
        isDeleted: false,
      },
      data: {
        status: "CANCELLED",
        isDeleted: true,
        nextRunAt: null,
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null,
        ...data,
      },
    });
  },
};
