import { prisma } from "../config/database.js";

const DEFAULT_QUERY_LIMIT = 100;
const MAX_QUERY_LIMIT = 250;
const DEFAULT_PROCESSING_LEASE_MS = 15 * 60 * 1000;
const TERMINAL_STATUSES = new Set(["SUCCESS", "FAILED", "SKIPPED"]);
const RUN_STATUSES = new Set(["PENDING", "PROCESSING", "SUCCESS", "FAILED", "SKIPPED"]);

function getClient(db) {
  return db || prisma;
}

function assertShop(shop) {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required for automatic product rule run repository access");
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
    throw new Error("Invalid automatic product rule run status");
  }
}

function assertTransitionAllowed(fromStatuses = [], toStatus) {
  assertAllowedStatus(toStatus);
  for (const fromStatus of fromStatuses) {
    assertAllowedStatus(fromStatus);
    if (TERMINAL_STATUSES.has(fromStatus)) {
      throw new Error("Terminal automatic product rule runs cannot transition");
    }
  }
}

function leaseUntil(now, leaseMs = DEFAULT_PROCESSING_LEASE_MS) {
  assertDate(now, "now");
  return new Date(now.getTime() + leaseMs);
}

export const automaticProductRuleRunRepository = {
  async create(data, db = prisma) {
    assertShop(data?.shop);
    return getClient(db).automaticProductRuleRun.create({ data });
  },

  async createByExecutionKey(data, db = prisma) {
    assertShop(data?.shop);
    return getClient(db).automaticProductRuleRun.upsert({
      where: { executionKey: data.executionKey },
      create: data,
      update: {},
    });
  },

  async findById(id, shop, db = prisma) {
    assertShop(shop);
    return getClient(db).automaticProductRuleRun.findFirst({
      where: { id, shop },
    });
  },

  async findByExecutionKey(executionKey, shop, db = prisma) {
    assertShop(shop);
    const run = await getClient(db).automaticProductRuleRun.findUnique({
      where: { executionKey },
    });
    return run?.shop === shop ? run : null;
  },

  async findByIdWithRule(id, shop, db = prisma) {
    assertShop(shop);
    const run = await getClient(db).automaticProductRuleRun.findFirst({
      where: { id, shop },
      include: { automaticProductRule: true },
    });

    if (
      run?.automaticProductRule &&
      (run.automaticProductRule.shop !== shop || run.automaticProductRule.isDeleted)
    ) {
      return { ...run, automaticProductRule: null };
    }

    return run;
  },

  async findByEditHistoryId(editHistoryId, shop, db = prisma) {
    assertShop(shop);
    const run = await getClient(db).automaticProductRuleRun.findFirst({
      where: { editHistoryId, shop },
      include: { automaticProductRule: true },
    });

    if (
      run?.automaticProductRule &&
      (run.automaticProductRule.shop !== shop || run.automaticProductRule.isDeleted)
    ) {
      return { ...run, automaticProductRule: null };
    }

    return run;
  },

  async updateById(id, shop, data, db = prisma) {
    assertShop(shop);
    return getClient(db).automaticProductRuleRun.updateMany({
      where: { id, shop },
      data,
    });
  },

  async updateByIdForStatuses(id, shop, allowedStatuses = [], data = {}, db = prisma) {
    assertShop(shop);
    if (data.status) {
      assertTransitionAllowed(allowedStatuses, data.status);
    }

    return getClient(db).automaticProductRuleRun.updateMany({
      where: {
        id,
        shop,
        ...(allowedStatuses.length ? { status: { in: allowedStatuses } } : {}),
      },
      data,
    });
  },

  async updatePendingToProcessing(id, shop, { now, worker = null, leaseMs } = {}, db = prisma) {
    assertShop(shop);
    assertDate(now, "now");

    return getClient(db).automaticProductRuleRun.updateMany({
      where: { id, shop, status: "PENDING" },
      data: {
        status: "PROCESSING",
        startedAt: now,
        lastAttemptAt: now,
        attemptCount: { increment: 1 },
        processingLeaseUntil: leaseUntil(now, leaseMs),
        processingLeaseOwner: worker,
      },
    });
  },

  async markPendingSkipped(id, shop, data = {}, db = prisma) {
    assertShop(shop);
    const completedAt = data.completedAt;
    assertDate(completedAt, "completedAt");

    return getClient(db).automaticProductRuleRun.updateMany({
      where: { id, shop, status: "PENDING" },
      data: { status: "SKIPPED", completedAt, ...data },
    });
  },

  async markProcessingFinished(id, shop, status, data = {}, db = prisma) {
    assertShop(shop);
    assertTransitionAllowed(["PROCESSING"], status);
    const completedAt = data.completedAt;
    assertDate(completedAt, "completedAt");

    return getClient(db).automaticProductRuleRun.updateMany({
      where: { id, shop, status: "PROCESSING" },
      data: {
        status,
        completedAt,
        processingLeaseUntil: null,
        processingLeaseOwner: null,
        ...data,
      },
    });
  },

  async listByRule(automaticProductRuleId, shop, opts = {}, db = prisma) {
    assertShop(shop);
    return getClient(db).automaticProductRuleRun.findMany({
      where: {
        automaticProductRuleId,
        shop,
        ...(opts.cursorId ? { id: { lt: opts.cursorId } } : {}),
      },
      select: opts.select,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: normalizeLimit(opts.limit),
    });
  },

  async groupStatusCounts(ruleIds = [], shop, db = prisma) {
    if (!ruleIds.length) return [];
    assertShop(shop);

    return getClient(db).automaticProductRuleRun.groupBy({
      by: ["automaticProductRuleId", "status"],
      where: { automaticProductRuleId: { in: ruleIds }, shop },
      _count: { _all: true },
    });
  },

  async findLatestRuns(ruleIds = [], shop, db = prisma) {
    if (!ruleIds.length) return [];
    assertShop(shop);

    return getClient(db).automaticProductRuleRun.findMany({
      where: { automaticProductRuleId: { in: ruleIds }, shop },
      orderBy: [
        { automaticProductRuleId: "asc" },
        { createdAt: "desc" },
        { id: "desc" },
      ],
      distinct: ["automaticProductRuleId"],
      take: normalizeLimit(ruleIds.length, ruleIds.length),
    });
  },

  async listPendingRunsWithoutHistory(shop, limit = DEFAULT_QUERY_LIMIT, db = prisma) {
    assertShop(shop);
    return getClient(db).automaticProductRuleRun.findMany({
      where: {
        shop,
        status: "PENDING",
        editHistoryId: null,
      },
      select: {
        id: true,
        automaticProductRuleId: true,
        shop: true,
        executionKey: true,
        createdAt: true,
        triggerSource: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: normalizeLimit(limit),
    });
  },

  async listStaleProcessingRuns(shop, now, limit = DEFAULT_QUERY_LIMIT, db = prisma) {
    assertShop(shop);
    assertDate(now, "now");

    return getClient(db).automaticProductRuleRun.findMany({
      where: {
        shop,
        status: "PROCESSING",
        processingLeaseUntil: { lt: now },
      },
      select: {
        id: true,
        automaticProductRuleId: true,
        shop: true,
        executionKey: true,
        processingLeaseUntil: true,
        processingLeaseOwner: true,
        attemptCount: true,
      },
      orderBy: [{ processingLeaseUntil: "asc" }, { id: "asc" }],
      take: normalizeLimit(limit),
    });
  },
};
