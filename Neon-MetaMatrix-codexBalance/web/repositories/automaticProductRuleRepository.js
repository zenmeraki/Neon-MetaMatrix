import { prisma } from "../config/database.js";

const DEFAULT_QUERY_LIMIT = 100;
const MAX_QUERY_LIMIT = 250;
const ACTIVE_RULE_COUNT_GUARD = 21;
const MIN_AUTOMATIC_RULE_INTERVAL_MINUTES = 5;
const STATUSES = new Set(["ACTIVE", "PAUSED", "FAILED", "CANCELLED"]);
const TRIGGER_TYPES = new Set(["EVENT", "SCHEDULED", "HYBRID"]);
const SCHEDULE_TYPES = new Set(["CRON", "DAILY", "WEEKLY", "MONTHLY", "EVERY_X_MINUTES"]);

const EVENT_RULE_RUN_SELECT = Object.freeze({
  id: true,
  shop: true,
  priority: true,
  createdAt: true,
});

function getClient(db) {
  return db || prisma;
}

function assertShop(shop) {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required for automatic product rule repository access");
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

function activeWindowWhere(now) {
  assertDate(now, "now");

  return {
    AND: [
      {
        OR: [
          { startAt: null },
          { startAt: { lte: now } },
        ],
      },
      {
        OR: [
          { endAt: null },
          { endAt: { gte: now } },
        ],
      },
    ],
  };
}

function validateRuleWrite(data = {}) {
  if (data.status !== undefined && !STATUSES.has(data.status)) {
    throw new Error("Invalid automatic product rule status");
  }

  if (data.triggerType !== undefined && !TRIGGER_TYPES.has(data.triggerType)) {
    throw new Error("Invalid automatic product rule triggerType");
  }

  if (data.scheduleType !== undefined && data.scheduleType !== null && !SCHEDULE_TYPES.has(data.scheduleType)) {
    throw new Error("Invalid automatic product rule scheduleType");
  }

  if (
    data.triggerType === "EVENT" &&
    (data.scheduleType || data.cronExpression || data.intervalMinutes || data.nextRunAt)
  ) {
    throw new Error("Event-only automatic product rules cannot include schedule fields");
  }

  if (
    ["SCHEDULED", "HYBRID"].includes(data.triggerType) &&
    data.status === "ACTIVE" &&
    !data.scheduleType
  ) {
    throw new Error("Active scheduled automatic product rules require a scheduleType");
  }

  if (
    data.scheduleType === "EVERY_X_MINUTES" &&
    Number.isInteger(data.intervalMinutes) &&
    data.intervalMinutes < MIN_AUTOMATIC_RULE_INTERVAL_MINUTES
  ) {
    throw new Error(
      `Automatic product rule interval must be at least ${MIN_AUTOMATIC_RULE_INTERVAL_MINUTES} minutes`,
    );
  }
}

export const automaticProductRuleRepository = {
  async create(data, db = prisma) {
    assertShop(data?.shop);
    validateRuleWrite(data);
    return getClient(db).automaticProductRule.create({ data });
  },

  async findById(id, shop, db = prisma) {
    assertShop(shop);
    return getClient(db).automaticProductRule.findFirst({
      where: { id, shop, isDeleted: false },
    });
  },

  async findByIdForShop(id, shop, db = prisma) {
    return this.findById(id, shop, db);
  },

  async listByShop(shopOrArgs, db = prisma) {
    const args = typeof shopOrArgs === "string" ? { shop: shopOrArgs } : shopOrArgs || {};
    const { shop, cursorId = null } = args;
    const limit = normalizeLimit(args.limit);
    assertShop(shop);

    return getClient(db).automaticProductRule.findMany({
      where: {
        shop,
        isDeleted: false,
        ...(cursorId ? { id: { lt: cursorId } } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
  },

  async updateById(id, shop, data, db = prisma) {
    assertShop(shop);
    validateRuleWrite(data);
    return getClient(db).automaticProductRule.updateMany({
      where: { id, shop, isDeleted: false },
      data,
    });
  },

  async countActiveByShop(shop, excludeId = null, db = prisma) {
    assertShop(shop);
    const activeRules = await getClient(db).automaticProductRule.findMany({
      where: {
        shop,
        isDeleted: false,
        status: "ACTIVE",
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
      take: ACTIVE_RULE_COUNT_GUARD,
    });
    return activeRules.length;
  },

  async findDueShops(now, limit = DEFAULT_QUERY_LIMIT, db = prisma) {
    assertDate(now, "now");
    const dueRules = await getClient(db).automaticProductRule.findMany({
      where: {
        isDeleted: false,
        status: "ACTIVE",
        triggerType: { in: ["SCHEDULED", "HYBRID"] },
        nextRunAt: { lte: now },
      },
      select: { shop: true },
      distinct: ["shop"],
      orderBy: [{ shop: "asc" }],
      take: normalizeLimit(limit),
    });

    return dueRules.map((rule) => rule.shop);
  },

  async findDueRuleIds({ shop, now, limit = DEFAULT_QUERY_LIMIT, cursorId = null }, db = prisma) {
    assertShop(shop);
    assertDate(now, "now");

    return getClient(db).automaticProductRule.findMany({
      where: {
        shop,
        isDeleted: false,
        status: "ACTIVE",
        triggerType: { in: ["SCHEDULED", "HYBRID"] },
        nextRunAt: { lte: now },
        ...(cursorId ? { id: { gt: cursorId } } : {}),
      },
      select: { id: true, shop: true },
      orderBy: [
        { priority: "asc" },
        { nextRunAt: "asc" },
        { createdAt: "asc" },
        { id: "asc" },
      ],
      take: normalizeLimit(limit),
    });
  },

  async listRunnableEventRulesByShop(shop, now, opts = {}, db = prisma) {
    assertShop(shop);
    assertDate(now, "now");
    const limit = normalizeLimit(opts.limit);

    return getClient(db).automaticProductRule.findMany({
      where: {
        shop,
        isDeleted: false,
        status: "ACTIVE",
        triggerType: { in: ["EVENT", "HYBRID"] },
        ...(opts.cursorId ? { id: { gt: opts.cursorId } } : {}),
        ...activeWindowWhere(now),
      },
      select: opts.select || EVENT_RULE_RUN_SELECT,
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: limit,
    });
  },

  async listSignalEligibleByShop(shop, now, opts = {}, db = prisma) {
    return this.listRunnableEventRulesByShop(shop, now, opts, db);
  },
};
