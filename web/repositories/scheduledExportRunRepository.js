import { prisma } from "../config/database.js";
import { merchantOperationRepository } from "./merchantOperationRepository.js";

function getClient(db) {
  return db || prisma;
}

function assertShop(shop) {
  if (!shop) {
    throw new Error("shop is required");
  }
}

export const scheduledExportRunRepository = {
  async create(data, db = prisma) {
    const operation = await merchantOperationRepository.createPlannedOperationForEdit(
      {
        shop: data.shop,
        type: "SCHEDULED_EXPORT",
        title: "Scheduled export run",
        source: "write_through",
        idempotencyKey: `scheduled-export-run:${data.executionKey || data.scheduledExportId}:${new Date(data.scheduledFor).toISOString()}`,
        totalItems: Number(data.totalItems || 0),
        startedAt: data.startedAt || null,
      },
      db,
    );
    return getClient(db).scheduledExportRun.create({
      data: {
        ...data,
        operationId: operation.id,
      },
    });
  },

  async findById(id, db = prisma) {
    return getClient(db).scheduledExportRun.findUnique({
      where: { id },
    });
  },

  async findByExecutionKey({ executionKey, shop }, db = prisma) {
    assertShop(shop);
    return getClient(db).scheduledExportRun.findFirst({
      where: {
        executionKey,
        shop,
      },
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

  async updateById(id, shop, data, db = prisma) {
    assertShop(shop);
    return getClient(db).scheduledExportRun.updateMany({
      where: {
        id,
        shop,
        status: {
          in: ["PENDING", "PROCESSING"],
        },
      },
      data: {
        ...(data?.exportJobId ? { exportJobId: data.exportJobId } : {}),
        ...(data?.errorMessage !== undefined
          ? { errorMessage: data.errorMessage }
          : {}),
        ...(data?.fileUrl !== undefined ? { fileUrl: data.fileUrl } : {}),
        ...(data?.totalItems !== undefined ? { totalItems: data.totalItems } : {}),
        ...(data?.durationMs !== undefined ? { durationMs: data.durationMs } : {}),
      },
    });
  },

  async updateByIdForStatuses(id, shop, statuses = [], data = {}, db = prisma) {
    assertShop(shop);
    const terminalStatuses = ["SUCCESS", "FAILED", "SKIPPED"];
    if (!statuses.length) {
      statuses = ["PENDING", "PROCESSING"];
    }
    if (statuses.some((status) => terminalStatuses.includes(status))) {
      throw new Error("TERMINAL_RUN_MUTATION_BLOCKED");
    }
    return getClient(db).scheduledExportRun.updateMany({
      where: {
        id,
        shop,
        ...(statuses.length ? { status: { in: statuses } } : {}),
      },
      data,
    });
  },

  async updateProcessingState(id, shop, db = prisma) {
    assertShop(shop);
    const staleCutoff = new Date(Date.now() - 15 * 60 * 1000);

    return getClient(db).scheduledExportRun.updateMany({
      where: {
        id,
        shop,
        OR: [
          { status: "PENDING" },
          {
            status: "PROCESSING",
            exportJobId: null,
            startedAt: {
              lt: staleCutoff,
            },
          },
        ],
      },
      data: {
        status: "PROCESSING",
        startedAt: new Date(),
      },
    });
  },

  async markPendingSkipped(id, shop, data = {}, db = prisma) {
    assertShop(shop);
    return getClient(db).scheduledExportRun.updateMany({
      where: {
        id,
        shop,
        status: "PENDING",
      },
      data: {
        status: "SKIPPED",
        completedAt: new Date(),
        ...data,
      },
    });
  },

  async markProcessingFinished(
    { id, shop, status, exportJobId = null, data = {} },
    db = prisma,
  ) {
    assertShop(shop);
    return getClient(db).scheduledExportRun.updateMany({
      where: {
        id,
        shop,
        status: "PROCESSING",
        ...(exportJobId ? { exportJobId } : {}),
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
