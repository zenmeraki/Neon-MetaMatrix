import { prisma } from "../config/database.js";

function getClient(db) {
  return db || prisma;
}

export const automaticProductRuleRunRepository = {
  async create(data, db = prisma) {
    return getClient(db).automaticProductRuleRun.create({ data });
  },

  async findById(id, db = prisma) {
    return getClient(db).automaticProductRuleRun.findUnique({ where: { id } });
  },

  async findByExecutionKey(executionKey, db = prisma) {
    return getClient(db).automaticProductRuleRun.findUnique({
      where: { executionKey },
    });
  },

  async findByIdWithRule(id, db = prisma) {
    return getClient(db).automaticProductRuleRun.findUnique({
      where: { id },
      include: { automaticProductRule: true },
    });
  },

  async findByEditHistoryId(editHistoryId, db = prisma) {
    return getClient(db).automaticProductRuleRun.findFirst({
      where: { editHistoryId },
      include: { automaticProductRule: true },
    });
  },

  async updateById(id, data, db = prisma) {
    return getClient(db).automaticProductRuleRun.update({
      where: { id },
      data,
    });
  },

  async updateByIdForStatuses(id, allowedStatuses = [], data = {}, db = prisma) {
    return getClient(db).automaticProductRuleRun.updateMany({
      where: {
        id,
        ...(allowedStatuses.length ? { status: { in: allowedStatuses } } : {}),
      },
      data,
    });
  },

  async updatePendingToProcessing(id, db = prisma) {
    return getClient(db).automaticProductRuleRun.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "PROCESSING", startedAt: new Date() },
    });
  },

  async markPendingSkipped(id, data = {}, db = prisma) {
    return getClient(db).automaticProductRuleRun.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "SKIPPED", completedAt: new Date(), ...data },
    });
  },

  async markProcessingFinished(id, status, data = {}, db = prisma) {
    return getClient(db).automaticProductRuleRun.updateMany({
      where: { id, status: "PROCESSING" },
      data: { status, completedAt: new Date(), ...data },
    });
  },

  async listByRule(automaticProductRuleId, shop, db = prisma) {
    return getClient(db).automaticProductRuleRun.findMany({
      where: { automaticProductRuleId, shop },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  },

  async groupStatusCounts(ruleIds = [], db = prisma) {
    if (!ruleIds.length) return [];

    return getClient(db).automaticProductRuleRun.groupBy({
      by: ["automaticProductRuleId", "status"],
      where: { automaticProductRuleId: { in: ruleIds } },
      _count: { _all: true },
    });
  },

  async findLatestRuns(ruleIds = [], db = prisma) {
    if (!ruleIds.length) return [];

    return getClient(db).automaticProductRuleRun.findMany({
      where: { automaticProductRuleId: { in: ruleIds } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  },

  async listPendingRunsWithoutHistory(limit = 100, db = prisma) {
    return getClient(db).automaticProductRuleRun.findMany({
      where: {
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
      take: limit,
    });
  },
};
