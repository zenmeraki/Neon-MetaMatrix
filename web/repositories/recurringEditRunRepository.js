import { prisma } from "../config/database.js";
import { merchantOperationRepository } from "./merchantOperationRepository.js";

function getClient(db) {
  return db || prisma;
}

export const recurringEditRunRepository = {
  async create(data, db = prisma) {
    const operation = await merchantOperationRepository.createPlannedOperationForEdit(
      {
        shop: data.shop,
        type: "SCHEDULED_EDIT",
        title: "Recurring edit run",
        source: "write_through",
        idempotencyKey: `recurring-run:${data.executionKey || data.recurringEditId}:${new Date(data.scheduledFor).toISOString()}`,
        totalItems: Number(data.totalItems || 0),
        startedAt: data.startedAt || null,
      },
      db,
    );
    return getClient(db).recurringRuleRun.create({
      data: {
        ...data,
        operationId: operation.id,
      },
    });
  },

  async updateById(id, data, db = prisma) {
    return getClient(db).recurringRuleRun.update({
      where: { id },
      data,
    });
  },

  async updateByIdForStatuses(id, statuses = [], data = {}, db = prisma) {
    return getClient(db).recurringRuleRun.updateMany({
      where: {
        id,
        ...(statuses.length ? { status: { in: statuses } } : {}),
      },
      data,
    });
  },

  async updatePendingToProcessing(id, db = prisma) {
    return getClient(db).recurringRuleRun.updateMany({
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
    return getClient(db).recurringRuleRun.updateMany({
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
    return getClient(db).recurringRuleRun.updateMany({
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
    return getClient(db).recurringRuleRun.findUnique({
      where: { id },
    });
  },

  async findByExecutionKey(executionKey, db = prisma) {
    return getClient(db).recurringRuleRun.findUnique({
      where: { executionKey },
    });
  },

  async findByIdWithRecurringEdit(id, db = prisma) {
    return getClient(db).recurringRuleRun.findUnique({
      where: { id },
      include: {
        recurringEdit: true,
      },
    });
  },

  async findByEditHistoryId(editHistoryId, db = prisma) {
    return getClient(db).recurringRuleRun.findFirst({
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

    return getClient(db).recurringRuleRun.groupBy({
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

    return getClient(db).recurringRuleRun.findMany({
      where: {
        recurringEditId: {
          in: recurringEditIds,
        },
      },
      orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }],
    });
  },
};
