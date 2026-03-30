import { prisma } from "../Config/database.js";

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
