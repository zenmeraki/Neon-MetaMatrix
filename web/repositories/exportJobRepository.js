import { prisma } from "../config/database.js";
import { assertLegacyExecutionProjectionWrite } from "../services/legacyExecutionWriteGuard.js";

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
    lastProcessedOrdinal: Number(data.lastProcessedOrdinal ?? 0),
    startedAt: data.startedAt ?? null,
    completedAt: data.completedAt ?? null,
    error: data.error ?? null,
    filterVersion: data.filterVersion ?? null,
    canonicalFilterKey: data.canonicalFilterKey ?? null,
  };
}

function assertProjection(data, reason) {
  assertLegacyExecutionProjectionWrite({
    model: "exportJob",
    data,
    reason,
  });
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
    const data = {
      status: "PROCESSING",
      startedAt: new Date(),
      error: null,
    };
    assertProjection(data, "export_job_mark_running");
    return getClient(db).exportJob.updateMany({
      where: {
        id,
        shop,
        status: "PENDING",
      },
      data,
    });
  },

  async markQueued(
    { id, shop, targetSnapshotCount = null },
    db = prisma,
  ) {
    const data = {
      executionState: "queued",
      ...(targetSnapshotCount !== null ? { targetSnapshotCount } : {}),
    };
    assertProjection(data, "export_job_mark_queued");
    return getClient(db).exportJob.updateMany({
      where: {
        id,
        shop,
        status: "PENDING",
        executionState: "planned",
      },
      data,
    });
  },

  async markFailedBeforeQueue(
    { id, shop, error, failureStage = null },
    db = prisma,
  ) {
    const data = {
      status: "FAILED",
      executionState: "failed",
      failureStage,
      error: error?.message || String(error || "Export failed"),
      completedAt: new Date(),
    };
    assertProjection(data, "export_job_mark_failed_before_queue");
    return getClient(db).exportJob.updateMany({
      where: {
        id,
        shop,
        status: "PENDING",
        executionState: "planned",
      },
      data,
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
    const data = {
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
    };
    assertProjection(data, "export_job_mark_completed");
    return getClient(db).exportJob.updateMany({
      where: {
        id,
        shop,
        status: "PROCESSING",
      },
      data,
    });
  },

  async markFailed({ id, shop, error }, db = prisma) {
    const data = {
      status: "FAILED",
      error: error?.message || String(error || "Export failed"),
    };
    assertProjection(data, "export_job_mark_failed");
    return getClient(db).exportJob.updateMany({
      where: {
        id,
        shop,
        status: {
          in: ["PENDING", "PROCESSING"],
        },
      },
      data,
    });
  },

  async projectionUpdateMany({ where, data, reason }, db = prisma) {
    assertProjection(data, reason);
    return getClient(db).exportJob.updateMany({ where, data });
  },

  async projectionUpdate({ where, data, reason }, db = prisma) {
    assertProjection(data, reason);
    return getClient(db).exportJob.update({ where, data });
  },
};
