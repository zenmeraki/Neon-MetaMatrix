import { prisma } from "../config/database.js";

function getClient(db) {
  return db || prisma;
}

function normalizeLimit(limit, fallback = 100, max = 500) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

export const automaticProductRuleRepository = {
  async create(data, db = prisma) {
    return getClient(db).automaticProductRule.create({ data });
  },

  // Internal only. Prefer findByIdForShop everywhere user/session scoped.
  async findById(id, db = prisma) {
    return getClient(db).automaticProductRule.findUnique({
      where: { id },
    });
  },

  async findByIdForShop(id, shop, db = prisma) {
    return getClient(db).automaticProductRule.findFirst({
      where: {
        id,
        shop,
        isDeleted: false,
      },
    });
  },

  async listByShop(shop, db = prisma) {
    return getClient(db).automaticProductRule.findMany({
      where: {
        shop,
        isDeleted: false,
      },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
  },

  async updateByIdForShop(id, shop, data, db = prisma) {
    return getClient(db).automaticProductRule.updateMany({
      where: {
        id,
        shop,
        isDeleted: false,
      },
      data,
    });
  },

  // Keep only for trusted internal migrations/admin paths.
  async updateById(id, data, db = prisma) {
    return getClient(db).automaticProductRule.update({
      where: { id },
      data,
    });
  },

  async softDeleteByIdForShop(id, shop, db = prisma) {
    return getClient(db).automaticProductRule.updateMany({
      where: {
        id,
        shop,
        isDeleted: false,
      },
      data: {
        isDeleted: true,
        status: "CANCELLED",
      },
    });
  },

  async countActiveByShop(shop, excludeId = null, db = prisma) {
    return getClient(db).automaticProductRule.count({
      where: {
        shop,
        isDeleted: false,
        status: "ACTIVE",
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  },

  async findDueRuleIds(now = new Date(), limit = 100, db = prisma) {
    const safeLimit = normalizeLimit(limit);

    return getClient(db).automaticProductRule.findMany({
      where: {
        isDeleted: false,
        status: "ACTIVE",
        triggerType: { in: ["SCHEDULED", "HYBRID"] },
        executionMode: "SCHEDULED",
        nextRunAt: { lte: now },
        OR: [{ startAt: null }, { startAt: { lte: now } }],
        AND: [{ OR: [{ endAt: null }, { endAt: { gte: now } }] }],
      },
      select: {
        id: true,
        shop: true,
        nextRunAt: true,
      },
      orderBy: [{ priority: "desc" }, { nextRunAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: safeLimit,
    });
  },

  async listRunnableEventRulesByShop(shop, now = new Date(), db = prisma) {
    return getClient(db).automaticProductRule.findMany({
      where: {
        shop,
        isDeleted: false,
        status: "ACTIVE",
        triggerType: { in: ["EVENT", "HYBRID"] },
        executionMode: "REALTIME",
        OR: [{ startAt: null }, { startAt: { lte: now } }],
        AND: [{ OR: [{ endAt: null }, { endAt: { gte: now } }] }],
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    });
  },

  async listSignalEligibleByShop(shop, db = prisma) {
    return this.listRunnableEventRulesByShop(shop, new Date(), db);
  },
};
