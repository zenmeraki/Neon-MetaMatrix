import { prisma } from "../Config/database.js";

function getClient(db) {
  return db || prisma;
}

export const automaticProductRuleRepository = {
  async create(data, db = prisma) {
    return getClient(db).automaticProductRule.create({ data });
  },

  async findById(id, db = prisma) {
    return getClient(db).automaticProductRule.findUnique({ where: { id } });
  },

  async findByIdForShop(id, shop, db = prisma) {
    return getClient(db).automaticProductRule.findFirst({
      where: { id, shop, isDeleted: false },
    });
  },

  async listByShop(shop, db = prisma) {
    return getClient(db).automaticProductRule.findMany({
      where: { shop, isDeleted: false },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  },

  async updateById(id, data, db = prisma) {
    return getClient(db).automaticProductRule.update({
      where: { id },
      data,
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

  async findDueRuleIds(now, limit = 100, db = prisma) {
    return getClient(db).automaticProductRule.findMany({
      where: {
        isDeleted: false,
        status: "ACTIVE",
        triggerType: { in: ["SCHEDULED", "HYBRID"] },
        nextRunAt: { lte: now },
      },
      select: { id: true },
      orderBy: [{ priority: "asc" }, { nextRunAt: "asc" }, { createdAt: "asc" }],
      take: limit,
    });
  },

  async listRunnableEventRulesByShop(shop, now = new Date(), db = prisma) {
    return getClient(db).automaticProductRule.findMany({
      where: {
        shop,
        isDeleted: false,
        status: "ACTIVE",
        triggerType: { in: ["EVENT", "HYBRID"] },
        OR: [
          { startAt: null },
          { startAt: { lte: now } },
        ],
        AND: [
          {
            OR: [
              { endAt: null },
              { endAt: { gte: now } },
            ],
          },
        ],
      },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
  },

  async listSignalEligibleByShop(shop, db = prisma) {
    return this.listRunnableEventRulesByShop(shop, new Date(), db);
  },
};
