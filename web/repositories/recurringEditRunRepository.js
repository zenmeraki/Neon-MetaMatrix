import { prisma } from "../Config/database.js";

function getClient(db) {
  return db || prisma;
}

export const recurringEditRunRepository = {
  async create(data, db = prisma) {
    return getClient(db).recurringEditRun.create({ data });
  },

  async updateById(id, data, db = prisma) {
    return getClient(db).recurringEditRun.update({
      where: { id },
      data,
    });
  },

  async updateByIdForStatuses(id, statuses = [], data = {}, db = prisma) {
    return getClient(db).recurringEditRun.updateMany({
      where: {
        id,
        ...(statuses.length ? { status: { in: statuses } } : {}),
      },
      data,
    });
  },

  async updatePendingToProcessing(id, db = prisma) {
    return getClient(db).recurringEditRun.updateMany({
      where: {
        id,
        status: "PENDING",
      },
      data: {
        status: "PROCESSING",
        startedAt: new Date(),
      },
    });
  },

  async markProcessingFinished(id, status, data = {}, db = prisma) {
    return getClient(db).recurringEditRun.updateMany({
      where: {
        id,
        status: "PROCESSING",
      },
      data: {
        status,
        completedAt: new Date(),
        ...data,
      },
    });
  },

  async markPendingSkipped(id, data = {}, db = prisma) {
    return getClient(db).recurringEditRun.updateMany({
      where: {
        id,
        status: "PENDING",
      },
      data: {
        status: "SKIPPED",
        completedAt: new Date(),
        ...data,
      },
    });
  },

  async findById(id, db = prisma) {
    return getClient(db).recurringEditRun.findUnique({
      where: { id },
    });
  },

  async findByExecutionKey(executionKey, db = prisma) {
    return getClient(db).recurringEditRun.findUnique({
      where: { executionKey },
    });
  },

  async findByIdWithRecurringEdit(id, db = prisma) {
    return getClient(db).recurringEditRun.findUnique({
      where: { id },
      include: {
        recurringEdit: true,
      },
    });
  },

  async findByEditHistoryId(editHistoryId, db = prisma) {
    return getClient(db).recurringEditRun.findFirst({
      where: { editHistoryId },
      include: {
        recurringEdit: true,
      },
    });
  },

  async groupStatusCounts(recurringEditIds = [], db = prisma) {
    if (!recurringEditIds.length) {
      return [];
    }

    return getClient(db).recurringEditRun.groupBy({
      by: ["recurringEditId", "status"],
      where: {
        recurringEditId: {
          in: recurringEditIds,
        },
      },
      _count: {
        _all: true,
      },
    });
  },

  async findLatestRuns(recurringEditIds = [], db = prisma) {
    if (!recurringEditIds.length) {
      return [];
    }

    return getClient(db).recurringEditRun.findMany({
      where: {
        recurringEditId: {
          in: recurringEditIds,
        },
      },
      orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }],
    });
  },
};
