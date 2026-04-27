import { prisma } from "../config/database.js";

function getClient(db) {
  return db || prisma;
}

function buildCreateData(data = {}) {
  return {
    shop: data.shop,
    type: data.type ?? "Manual export",
    status: data.status ?? "PENDING",
    filterQuery: data.filterQuery ?? "{}",
    executionState: data.executionState ?? "planned",
    targetSnapshotCount: data.targetSnapshotCount ?? 0,
    targetMirrorBatchId: data.targetMirrorBatchId ?? null,
    mirrorBatchId: data.mirrorBatchId ?? null,
    failureStage: data.failureStage ?? null,
    filename: data.filename,
    fields: Array.isArray(data.fields) ? data.fields : [],
    fileKey: data.fileKey ?? null,
    fileUrl: data.fileUrl ?? null,
    mimeType: data.mimeType ?? null,
    fileSizeBytes: data.fileSizeBytes ?? null,
    rowCount: Number(data.rowCount ?? 0),
    productCount: Number(data.productCount ?? 0),
    isScheduled: Boolean(data.isScheduled),
    scheduledExportId: data.scheduledExportId ?? null,
    scheduledExportRunId: data.scheduledExportRunId ?? null,
    triggerType: data.triggerType ?? "MANUAL",
    totalItems: data.totalItems ?? null,
    durationMs: data.durationMs ?? null,
    startedAt: data.startedAt ?? null,
    completedAt: data.completedAt ?? null,
    error: data.error ?? null,
    filterVersion: data.filterVersion ?? null,
    canonicalFilterKey: data.canonicalFilterKey ?? null,
  };
}

export const exportJobRepository = {
  async create(data, db = prisma) {
    return getClient(db).exportJob.create({
      data: buildCreateData(data),
    });
  },

  async findByIdForShop(id, shop, db = prisma) {
    return getClient(db).exportJob.findFirst({
      where: { id, shop },
    });
  },

  async listRecentByShop(shop, take = 10, db = prisma) {
    return getClient(db).exportJob.findMany({
      where: { shop },
      orderBy: [{ createdAt: "desc" }, { updatedAt: "desc" }],
      take,
    });
  },

  async markRunning(id, shop, db = prisma) {
    return getClient(db).exportJob.updateMany({
      where: {
        id,
        shop,
        status: "PENDING",
      },
      data: {
        status: "PROCESSING",
        startedAt: new Date(),
        error: null,
      },
    });
  },

  async markQueued(
    { id, shop, targetSnapshotCount = null },
    db = prisma,
  ) {
    return getClient(db).exportJob.updateMany({
      where: {
        id,
        shop,
        status: "PENDING",
        executionState: "planned",
      },
      data: {
        executionState: "queued",
        ...(targetSnapshotCount !== null ? { targetSnapshotCount } : {}),
      },
    });
  },

  async markFailedBeforeQueue(
    { id, shop, error, failureStage = null },
    db = prisma,
  ) {
    return getClient(db).exportJob.updateMany({
      where: {
        id,
        shop,
        status: "PENDING",
        executionState: "planned",
      },
      data: {
        status: "FAILED",
        executionState: "failed",
        failureStage,
        error: error?.message || String(error || "Export failed"),
        completedAt: new Date(),
      },
    });
  },

  async markCompleted(
    {
      id,
      shop,
      fileKey,
      fileUrl,
      fileName,
      mimeType,
      fileSizeBytes,
      rowCount,
      productCount,
      mirrorBatchId,
    },
    db = prisma,
  ) {
    return getClient(db).exportJob.updateMany({
      where: {
        id,
        shop,
        status: "PROCESSING",
      },
      data: {
        status: "COMPLETED",
        fileKey,
        fileUrl,
        ...(fileName ? { filename: fileName } : {}),
        mimeType,
        fileSizeBytes,
        rowCount,
        productCount,
        mirrorBatchId,
        completedAt: new Date(),
        error: null,
      },
    });
  },

  async markFailed({ id, shop, error }, db = prisma) {
    return getClient(db).exportJob.updateMany({
      where: {
        id,
        shop,
        status: {
          in: ["PENDING", "PROCESSING"],
        },
      },
      data: {
        status: "FAILED",
        error: error?.message || String(error || "Export failed"),
      },
    });
  },
};
