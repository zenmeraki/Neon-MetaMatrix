import { prisma } from "../config/database.js";

const DEFAULT_QUERY_LIMIT = 100;
const MAX_QUERY_LIMIT = 250;
const DEFAULT_PROCESSING_LEASE_MS = 15 * 60 * 1000;
const RUN_STATUSES = new Set(["PENDING", "PROCESSING", "SUCCESS", "FAILED", "SKIPPED"]);
const TERMINAL_STATUSES = new Set(["SUCCESS", "FAILED", "SKIPPED"]);

function getClient(db) {
  return db || prisma;
}

function assertShop(shop) {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required for recurring edit run repository access");
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

function assertAllowedStatus(status) {
  if (!RUN_STATUSES.has(status)) {
    throw new Error("Invalid recurring edit run status");
  }
}

function assertTransitionAllowed(fromStatuses = [], toStatus) {
  assertAllowedStatus(toStatus);
  for (const fromStatus of fromStatuses) {
    assertAllowedStatus(fromStatus);
    if (TERMINAL_STATUSES.has(fromStatus)) {
      throw new Error("Terminal recurring edit runs cannot transition");
    }
  }
}

function leaseUntil(now, leaseMs = DEFAULT_PROCESSING_LEASE_MS) {
  assertDate(now, "now");
  return new Date(now.getTime() + leaseMs);
}

function scrubSoftDeletedRecurringEdit(run, shop) {
  if (
    run?.recurringEdit &&
    (run.recurringEdit.shop !== shop || run.recurringEdit.isDeleted)
  ) {
    return { ...run, recurringEdit: null };
  }
  return run;
}

export const recurringEditRunRepository = {
  async create(data, db = prisma) {
    assertShop(data?.shop);
    return getClient(db).recurringEditRun.create({ data });
  },

  async createByExecutionKey(data, db = prisma) {
    assertShop(data?.shop);
    return getClient(db).recurringEditRun.upsert({
      where: { executionKey: data.executionKey },
      create: data,
      update: {},
    });
  },

  async updateById(id, shop, data, db = prisma) {
    assertShop(shop);
    return getClient(db).recurringEditRun.updateMany({
      where: {
        id,
        shop,
        status: { notIn: [...TERMINAL_STATUSES] },
      },
      data,
    });
  },

  async updateByIdForStatuses(id, shop, statuses = [], data = {}, db = prisma) {
    assertShop(shop);
    if (!statuses.length) {
      throw new Error("statuses are required for recurring edit run transition");
    }
    if (data.status) {
      assertTransitionAllowed(statuses, data.status);
    }

    return getClient(db).recurringEditRun.updateMany({
      where: {
        id,
        shop,
        status: { in: statuses },
      },
      data,
    });
  },

  async updatePendingToProcessing(id, shop, { now, worker = null, leaseMs } = {}, db = prisma) {
    assertShop(shop);
    assertDate(now, "now");

    const transition = await getClient(db).recurringEditRun.updateMany({
      where: {
        id,
        shop,
        status: "PENDING",
      },
      data: {
        status: "PROCESSING",
        startedAt: now,
        processingLeaseUntil: leaseUntil(now, leaseMs),
        processingLeaseOwner: worker,
        lastAttemptAt: now,
        attemptCount: { increment: 1 },
      },
    });

    if (transition.count !== 1) {
      return transition;
    }
    return transition;
  },

  async markProcessingFinished(id, shop, status, data = {}, db = prisma) {
    assertShop(shop);
    assertTransitionAllowed(["PROCESSING"], status);
    const completedAt = data.completedAt;
    assertDate(completedAt, "completedAt");

    const transition = await getClient(db).recurringEditRun.updateMany({
      where: {
        id,
        shop,
        status: "PROCESSING",
      },
      data: {
        status,
        completedAt,
        processingLeaseUntil: null,
        processingLeaseOwner: null,
        ...data,
      },
    });

    return transition;
  },

  async markPendingSkipped(id, shop, data = {}, db = prisma) {
    assertShop(shop);
    const completedAt = data.completedAt;
    assertDate(completedAt, "completedAt");

    return getClient(db).recurringEditRun.updateMany({
      where: {
        id,
        shop,
        status: "PENDING",
      },
      data: {
        status: "SKIPPED",
        completedAt,
        ...data,
      },
    });
  },

  async findById(id, shop, db = prisma) {
    assertShop(shop);
    return getClient(db).recurringEditRun.findFirst({
      where: { id, shop },
    });
  },

  async findByExecutionKey(executionKey, shop, db = prisma) {
    assertShop(shop);
    const run = await getClient(db).recurringEditRun.findUnique({
      where: { executionKey },
    });
    return run?.shop === shop ? run : null;
  },

  async findByIdWithRecurringEdit(id, shop, db = prisma) {
    assertShop(shop);
    const run = await getClient(db).recurringEditRun.findFirst({
      where: { id, shop },
      include: { recurringEdit: true },
    });
    return scrubSoftDeletedRecurringEdit(run, shop);
  },

  async findByEditHistoryId(editHistoryId, shop, db = prisma) {
    assertShop(shop);
    const run = await getClient(db).recurringEditRun.findFirst({
      where: { editHistoryId, shop },
      include: { recurringEdit: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return scrubSoftDeletedRecurringEdit(run, shop);
  },

  async groupStatusCounts(recurringEditIds = [], shop, db = prisma) {
    if (!recurringEditIds.length) return [];
    assertShop(shop);

    return getClient(db).recurringEditRun.groupBy({
      by: ["recurringEditId", "status"],
      where: {
        recurringEditId: { in: recurringEditIds },
        shop,
      },
      _count: { _all: true },
    });
  },

  async findLatestRuns(recurringEditIds = [], shop, db = prisma) {
    if (!recurringEditIds.length) return [];
    assertShop(shop);

    return getClient(db).recurringEditRun.findMany({
      where: {
        recurringEditId: { in: recurringEditIds },
        shop,
      },
      orderBy: [
        { recurringEditId: "asc" },
        { scheduledFor: "desc" },
        { createdAt: "desc" },
        { id: "desc" },
      ],
      distinct: ["recurringEditId"],
      take: normalizeLimit(recurringEditIds.length, recurringEditIds.length),
    });
  },

  async listByRecurringEdit(recurringEditId, shop, opts = {}, db = prisma) {
    assertShop(shop);
    return getClient(db).recurringEditRun.findMany({
      where: {
        recurringEditId,
        shop,
        ...(opts.cursorId ? { id: { lt: opts.cursorId } } : {}),
      },
      ...(opts.select ? { select: opts.select } : {}),
      orderBy: [{ scheduledFor: "desc" }, { id: "desc" }],
      take: normalizeLimit(opts.limit),
    });
  },

  async listPendingRuns(shop, limit = DEFAULT_QUERY_LIMIT, db = prisma) {
    assertShop(shop);
    return getClient(db).recurringEditRun.findMany({
      where: {
        shop,
        status: "PENDING",
      },
      select: {
        id: true,
        recurringEditId: true,
        shop: true,
        executionKey: true,
        scheduledFor: true,
      },
      orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
      take: normalizeLimit(limit),
    });
  },

  async listStaleProcessingRuns(shop, now, limit = DEFAULT_QUERY_LIMIT, db = prisma) {
    assertShop(shop);
    assertDate(now, "now");

    return getClient(db).recurringEditRun.findMany({
      where: {
        shop,
        status: "PROCESSING",
        processingLeaseUntil: { lt: now },
      },
      select: {
        id: true,
        recurringEditId: true,
        shop: true,
        executionKey: true,
        scheduledFor: true,
        processingLeaseUntil: true,
        processingLeaseOwner: true,
        attemptCount: true,
      },
      orderBy: [{ processingLeaseUntil: "asc" }, { id: "asc" }],
      take: normalizeLimit(limit),
    });
  },

  async extendProcessingLease(id, shop, { now, worker, leaseMs } = {}, db = prisma) {
    assertShop(shop);
    assertDate(now, "now");
    if (!worker) throw new Error("worker is required to extend recurring run lease");

    return getClient(db).recurringEditRun.updateMany({
      where: {
        id,
        shop,
        status: "PROCESSING",
        processingLeaseOwner: worker,
      },
      data: {
        processingLeaseUntil: leaseUntil(now, leaseMs),
        lastAttemptAt: now,
      },
    });
  },
};
