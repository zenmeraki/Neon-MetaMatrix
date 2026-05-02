import { prisma } from "../config/database.js";

function getClient(db) {
  return db || prisma;
}

export const scheduledExportRunRepository = {
  async create(data, db = prisma) {
    return getClient(db).scheduledExportRun.create({ data });
  },

  async findById(id, db = prisma) {
    return getClient(db).scheduledExportRun.findUnique({
      where: { id },
    });
  },

  async findByExecutionKey(executionKey, db = prisma) {
    return getClient(db).scheduledExportRun.findUnique({
      where: { executionKey },
    });
  },

  async findByIdWithScheduledExport(id, db = prisma) {
    return getClient(db).scheduledExportRun.findUnique({
      where: { id },
      include: {
        scheduledExport: true,
      },
    });
  },

  async updateById(id, data, db = prisma) {
    return getClient(db).scheduledExportRun.update({
      where: { id },
      data,
    });
  },

  async updateByIdForStatuses(id, statuses = [], data = {}, db = prisma) {
    return getClient(db).scheduledExportRun.updateMany({
      where: {
        id,
        ...(statuses.length ? { status: { in: statuses } } : {}),
      },
      data,
    });
  },

  async updateProcessingState(id, db = prisma) {
    return getClient(db).scheduledExportRun.updateMany({
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

  async markPendingSkipped(id, data = {}, db = prisma) {
    return getClient(db).scheduledExportRun.updateMany({
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

  async markProcessingFinished(id, status, data = {}, db = prisma) {
    return getClient(db).scheduledExportRun.updateMany({
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

  async groupStatusCounts(scheduledExportIds = [], db = prisma) {
    if (!scheduledExportIds.length) {
      return [];
    }

    return getClient(db).scheduledExportRun.groupBy({
      by: ["scheduledExportId", "status"],
      where: {
        scheduledExportId: {
          in: scheduledExportIds,
        },
      },
      _count: {
        _all: true,
      },
    });
  },

  async findLatestRuns(scheduledExportIds = [], db = prisma) {
    if (!scheduledExportIds.length) {
      return [];
    }

    return getClient(db).scheduledExportRun.findMany({
      where: {
        scheduledExportId: {
          in: scheduledExportIds,
        },
      },
      orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }],
    });
  },
};
