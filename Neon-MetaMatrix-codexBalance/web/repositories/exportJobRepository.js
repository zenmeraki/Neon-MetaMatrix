import { prisma } from "../config/database.js";
import { Prisma } from "../generated/prisma/index.js";
import {
  EXPORT_EXECUTION_STATES,
  appendSerializedExportError,
  buildExportExecutionError,
  isTerminalExportExecutionState,
} from "../services/exportExecutionStateService.js";

const MAX_RECENT_EXPORTS = 100;
const MAX_FIELDS = 80;
const DEFAULT_LEASE_MS = 15 * 60 * 1000;
const ACTIVE_STATUSES = ["PENDING", "PROCESSING"];
const TERMINAL_STATUSES = ["COMPLETED", "FAILED", "CANCELLED", "PARTIAL"];
const SUPPORTED_EXPORT_FIELDS = new Set([
  "title",
  "description",
  "vendor",
  "productType",
  "handle",
  "status",
  "metaTitle",
  "metaDescription",
  "tags",
  "collections",
  "category",
  "price",
  "compareAtPrice",
  "sku",
  "barcode",
  "taxable",
  "variantTitle",
  "inventoryQuantity",
  "option1Name",
  "option2Name",
  "option3Name",
  "option1Values",
  "option2Values",
  "option3Values",
]);

const EXPORT_JOB_SELECT = {
  id: true,
  shop: true,
  executionKey: true,
  filterQuery: true,
  executionState: true,
  lockedAt: true,
  lockedBy: true,
  queuedAt: true,
  rowCursorOrdinal: true,
  generatedRowCount: true,
  fileFinalizedAt: true,
  fileExpiresAt: true,
  targetSnapshotCount: true,
  targetMirrorBatchId: true,
  mirrorBatchId: true,
  failureStage: true,
  filename: true,
  fileName: true,
  fields: true,
  status: true,
  fileKey: true,
  fileUrl: true,
  mimeType: true,
  fileSizeBytes: true,
  rowCount: true,
  productCount: true,
  type: true,
  isScheduled: true,
  scheduledExportId: true,
  scheduledExportRunId: true,
  triggerType: true,
  totalItems: true,
  durationMs: true,
  startedAt: true,
  completedAt: true,
  error: true,
  createdAt: true,
  updatedAt: true,
  filterVersion: true,
  canonicalFilterKey: true,
};

function getClient(db) {
  return db || prisma;
}

function assertShop(shop) {
  if (!shop || typeof shop !== "string") throw new Error("shop is required");
}

function assertIdAndShop(id, shop) {
  if (!id) throw new Error("exportJob id is required");
  assertShop(shop);
}

function assertDate(value, name) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${name} must be a valid Date`);
  }
}

function normalizeTake(take) {
  const parsed = Number.parseInt(take, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
  return Math.min(parsed, MAX_RECENT_EXPORTS);
}

function normalizeFields(fields) {
  if (!Array.isArray(fields) || !fields.length) {
    throw new Error("at least one export field is required");
  }
  if (fields.length > MAX_FIELDS) {
    throw new Error(`export fields are limited to ${MAX_FIELDS}`);
  }

  const normalized = [...new Set(fields.map(String))];
  const unsupported = normalized.filter((field) => !SUPPORTED_EXPORT_FIELDS.has(field));
  if (unsupported.length) {
    throw new Error(`unsupported export fields: ${unsupported.join(", ")}`);
  }
  return normalized;
}

function normalizeFilterQuery(filterQuery) {
  if (filterQuery && typeof filterQuery === "object") return JSON.stringify(filterQuery);
  if (typeof filterQuery !== "string") throw new Error("filterQuery must be a JSON string");
  JSON.parse(filterQuery || "{}");
  return filterQuery || "{}";
}

function assertNonNegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function executionKeyFor(data) {
  if (data.executionKey) return data.executionKey;
  if (data.scheduledExportRunId) return `scheduled-run:${data.shop}:${data.scheduledExportRunId}`;
  return null;
}

function durationFrom(startedAt, completedAt) {
  if (!startedAt) return null;
  return Math.max(0, completedAt.getTime() - new Date(startedAt).getTime());
}

function leaseUntil(now, leaseMs = DEFAULT_LEASE_MS) {
  return new Date(now.getTime() + leaseMs);
}

async function assertActiveMirrorBatch(client, shop, mirrorBatchId) {
  if (!mirrorBatchId) return;
  const product = await client.product.findFirst({
    where: { shop, mirrorBatchId, deletedAt: null },
    select: { id: true },
  });
  if (!product) {
    throw new Error("mirror batch does not reference an active catalog snapshot for shop");
  }
}

async function assertScheduledOwners(client, data) {
  if (data.scheduledExportId) {
    const scheduledExport = await client.scheduledExport.findFirst({
      where: { id: data.scheduledExportId, shop: data.shop, isDeleted: false },
      select: { id: true },
    });
    if (!scheduledExport) throw new Error("scheduledExportId does not belong to shop");
  }

  if (data.scheduledExportRunId) {
    const scheduledRun = await client.scheduledExportRun.findFirst({
      where: { id: data.scheduledExportRunId, shop: data.shop },
      select: { id: true, scheduledExportId: true },
    });
    if (!scheduledRun) throw new Error("scheduledExportRunId does not belong to shop");
    if (data.scheduledExportId && scheduledRun.scheduledExportId !== data.scheduledExportId) {
      throw new Error("scheduledExportRunId does not belong to scheduledExportId");
    }
  }
}

function buildCreateData(data = {}) {
  assertShop(data.shop);
  const fields = normalizeFields(data.fields);
  const filterQuery = normalizeFilterQuery(data.filterQuery ?? "{}");
  const executionKey = executionKeyFor(data);
  if (!executionKey) throw new Error("executionKey is required");
  if (data.executionState && data.executionState !== EXPORT_EXECUTION_STATES.PLANNED) {
    throw new Error("export jobs must be created in planned execution state");
  }
  if (data.status && data.status !== "PENDING") {
    throw new Error("export jobs must be created with PENDING status");
  }
  if (!data.filename || typeof data.filename !== "string") {
    throw new Error("filename is required");
  }
  if (!data.mimeType) {
    throw new Error("mimeType is required");
  }
  if (data.targetMirrorBatchId && data.mirrorBatchId && data.targetMirrorBatchId !== data.mirrorBatchId) {
    throw new Error("targetMirrorBatchId and mirrorBatchId must match when both are provided");
  }

  return {
    shop: data.shop,
    executionKey,
    type: data.type ?? "Manual export",
    status: "PENDING",
    filterQuery,
    executionState: EXPORT_EXECUTION_STATES.PLANNED,
    targetSnapshotCount: data.targetSnapshotCount ?? 0,
    targetMirrorBatchId: data.targetMirrorBatchId ?? null,
    mirrorBatchId: data.mirrorBatchId ?? data.targetMirrorBatchId ?? null,
    failureStage: null,
    filename: data.filename,
    fields,
    fileKey: null,
    fileUrl: null,
    mimeType: data.mimeType,
    fileSizeBytes: null,
    rowCount: 0,
    productCount: 0,
    isScheduled: Boolean(data.isScheduled),
    scheduledExportId: data.scheduledExportId ?? null,
    scheduledExportRunId: data.scheduledExportRunId ?? null,
    triggerType: data.triggerType ?? "MANUAL",
    totalItems: null,
    durationMs: null,
    startedAt: null,
    completedAt: null,
    error: null,
    filterVersion: data.filterVersion ?? null,
    canonicalFilterKey: data.canonicalFilterKey ?? null,
  };
}

async function countFrozenTargets(client, id, shop) {
  return client.targetSnapshot.count({
    where: { ownerType: "EXPORT_JOB", ownerId: id, shop },
  });
}

export const exportJobRepository = {
  async create(data, db = prisma) {
    const client = getClient(db);
    const createData = buildCreateData(data);
    await assertActiveMirrorBatch(client, createData.shop, createData.targetMirrorBatchId);
    await assertScheduledOwners(client, createData);

    const existing = await client.exportJob.findFirst({
      where: { shop: createData.shop, executionKey: createData.executionKey },
      select: EXPORT_JOB_SELECT,
    });
    if (existing) return existing;

    try {
      return await client.exportJob.create({ data: createData });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return client.exportJob.findFirst({
          where: { shop: createData.shop, executionKey: createData.executionKey },
          select: EXPORT_JOB_SELECT,
        });
      }
      throw error;
    }
  },

  async findByIdForShop(id, shop, db = prisma) {
    assertIdAndShop(id, shop);
    return getClient(db).exportJob.findFirst({
      where: { id, shop },
      select: EXPORT_JOB_SELECT,
    });
  },

  async listRecentByShop(shop, take = 10, db = prisma) {
    assertShop(shop);
    return getClient(db).exportJob.findMany({
      where: { shop },
      select: EXPORT_JOB_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: normalizeTake(take),
    });
  },

  async findActiveByShop(shop, db = prisma) {
    assertShop(shop);
    return getClient(db).exportJob.findFirst({
      where: {
        shop,
        status: { in: ACTIVE_STATUSES },
        executionState: {
          in: [
            EXPORT_EXECUTION_STATES.QUEUED,
            EXPORT_EXECUTION_STATES.RUNNING,
            EXPORT_EXECUTION_STATES.FINALIZING,
          ],
        },
      },
      select: EXPORT_JOB_SELECT,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  },

  async markQueued({ id, shop, targetSnapshotCount = null, now }, db = prisma) {
    assertIdAndShop(id, shop);
    assertDate(now, "now");
    if (targetSnapshotCount !== null) assertNonNegativeInteger(targetSnapshotCount, "targetSnapshotCount");
    if (targetSnapshotCount !== null && targetSnapshotCount <= 0) {
      throw new Error("targetSnapshotCount must be greater than 0 before queueing");
    }

    const client = getClient(db);
    const frozenCount = await countFrozenTargets(client, id, shop);
    const expectedCount = targetSnapshotCount ?? frozenCount;
    if (expectedCount <= 0 || frozenCount !== expectedCount) {
      throw new Error("Frozen target snapshot count does not match export job target count");
    }

    const transition = await client.exportJob.updateMany({
      where: {
        id,
        shop,
        status: "PENDING",
        executionState: EXPORT_EXECUTION_STATES.PLANNED,
      },
      data: {
        executionState: EXPORT_EXECUTION_STATES.QUEUED,
        queuedAt: now,
        targetSnapshotCount: expectedCount,
        totalItems: expectedCount,
      },
    });

    if (transition.count !== 1) throw new Error("Export job could not transition to queued");
    return transition;
  },

  async claimForExecution({ id, shop, worker, now, leaseMs }, db = prisma) {
    assertIdAndShop(id, shop);
    if (!worker) throw new Error("worker is required");
    assertDate(now, "now");

    const client = getClient(db);
    const active = await this.findActiveByShop(shop, client);
    if (active && active.id !== id) return { state: "shop_busy", exportJob: active };

    const transition = await client.exportJob.updateMany({
      where: {
        id,
        shop,
        status: "PENDING",
        executionState: EXPORT_EXECUTION_STATES.QUEUED,
        targetSnapshotCount: { gt: 0 },
        OR: [
          { lockedAt: null },
          { lockedAt: { lt: new Date(now.getTime() - (leaseMs || DEFAULT_LEASE_MS)) } },
          { lockedBy: worker },
        ],
      },
      data: {
        status: "PROCESSING",
        executionState: EXPORT_EXECUTION_STATES.RUNNING,
        startedAt: now,
        lockedAt: now,
        lockedBy: worker,
        error: null,
        failureStage: null,
      },
    });

    if (transition.count !== 1) return { state: "not_claimed", exportJob: null };
    return {
      state: "claimed",
      exportJob: await this.findByIdForShop(id, shop, client),
    };
  },

  async markRunning(id, shop, db = prisma) {
    return this.claimForExecution({
      id,
      shop,
      worker: "legacy-export-worker",
      now: new Date(),
    }, db);
  },

  async saveProgress({ id, shop, rowCursorOrdinal, generatedRowCount }, db = prisma) {
    assertIdAndShop(id, shop);
    assertNonNegativeInteger(rowCursorOrdinal, "rowCursorOrdinal");
    assertNonNegativeInteger(generatedRowCount, "generatedRowCount");

    return getClient(db).exportJob.updateMany({
      where: {
        id,
        shop,
        status: "PROCESSING",
        executionState: EXPORT_EXECUTION_STATES.RUNNING,
      },
      data: { rowCursorOrdinal, generatedRowCount },
    });
  },

  async markFinalizing({ id, shop, now }, db = prisma) {
    assertIdAndShop(id, shop);
    assertDate(now, "now");

    const transition = await getClient(db).exportJob.updateMany({
      where: {
        id,
        shop,
        status: "PROCESSING",
        executionState: EXPORT_EXECUTION_STATES.RUNNING,
      },
      data: {
        executionState: EXPORT_EXECUTION_STATES.FINALIZING,
        lockedAt: now,
      },
    });
    if (transition.count !== 1) throw new Error("Export could not transition to finalizing");
    return transition;
  },

  async finalizeFileUpload({ id, shop, fileKey, fileUrl, mimeType, fileSizeBytes, now, fileExpiresAt = null }, db = prisma) {
    assertIdAndShop(id, shop);
    assertDate(now, "now");
    if (!fileKey || !fileUrl) throw new Error("fileKey and fileUrl are required");
    if (!mimeType || !Number.isInteger(fileSizeBytes) || fileSizeBytes <= 0) {
      throw new Error("mimeType and positive fileSizeBytes are required");
    }

    return getClient(db).exportJob.updateMany({
      where: {
        id,
        shop,
        status: "PROCESSING",
        executionState: EXPORT_EXECUTION_STATES.FINALIZING,
      },
      data: {
        fileKey,
        fileUrl,
        mimeType,
        fileSizeBytes,
        fileFinalizedAt: now,
        fileExpiresAt,
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
      now,
    },
    db = prisma,
  ) {
    assertIdAndShop(id, shop);
    assertDate(now, "now");
    if (!fileKey || !fileUrl) throw new Error("fileKey and fileUrl are required");
    if (!mimeType || !Number.isInteger(fileSizeBytes) || fileSizeBytes <= 0) {
      throw new Error("mimeType and positive fileSizeBytes are required");
    }
    assertNonNegativeInteger(rowCount, "rowCount");
    assertNonNegativeInteger(productCount, "productCount");

    const client = getClient(db);
    const job = await client.exportJob.findFirst({
      where: {
        id,
        shop,
        status: "PROCESSING",
        executionState: EXPORT_EXECUTION_STATES.FINALIZING,
      },
      select: {
        startedAt: true,
        targetSnapshotCount: true,
        targetMirrorBatchId: true,
      },
    });
    if (!job) throw new Error("Export job is not completable");
    if (productCount !== job.targetSnapshotCount) {
      throw new Error("productCount must match targetSnapshotCount");
    }
    if (job.targetMirrorBatchId && mirrorBatchId && job.targetMirrorBatchId !== mirrorBatchId) {
      throw new Error("completion mirrorBatchId does not match target snapshot");
    }

    const transition = await client.exportJob.updateMany({
      where: {
        id,
        shop,
        status: "PROCESSING",
        executionState: EXPORT_EXECUTION_STATES.FINALIZING,
      },
      data: {
        status: "COMPLETED",
        executionState: EXPORT_EXECUTION_STATES.COMPLETED,
        fileKey,
        fileUrl,
        ...(fileName ? { filename: fileName, fileName } : {}),
        mimeType,
        fileSizeBytes,
        rowCount,
        productCount,
        totalItems: rowCount,
        mirrorBatchId: mirrorBatchId || job.targetMirrorBatchId,
        durationMs: durationFrom(job.startedAt, now),
        completedAt: now,
        fileFinalizedAt: now,
        lockedAt: null,
        lockedBy: null,
        failureStage: null,
        error: null,
      },
    });
    if (transition.count !== 1) throw new Error("Export job could not be completed");
    return transition;
  },

  async markFailedBeforeQueue({ id, shop, error, failureStage = null, now }, db = prisma) {
    assertIdAndShop(id, shop);
    assertDate(now, "now");

    return this.markFailed({ id, shop, error, failureStage, now }, db);
  },

  async markFailed({ id, shop, error, failureStage = "export_failed", now }, db = prisma) {
    assertIdAndShop(id, shop);
    assertDate(now, "now");
    const client = getClient(db);
    const current = await client.exportJob.findFirst({
      where: {
        id,
        shop,
        status: { in: ACTIVE_STATUSES },
        executionState: {
          notIn: [
            EXPORT_EXECUTION_STATES.COMPLETED,
            EXPORT_EXECUTION_STATES.CANCELLED,
            EXPORT_EXECUTION_STATES.PARTIAL,
          ],
        },
      },
      select: { error: true, startedAt: true, executionState: true },
    });
    if (!current || isTerminalExportExecutionState(current.executionState)) return { count: 0 };

    return client.exportJob.updateMany({
      where: {
        id,
        shop,
        status: { in: ACTIVE_STATUSES },
        executionState: {
          notIn: [
            EXPORT_EXECUTION_STATES.COMPLETED,
            EXPORT_EXECUTION_STATES.CANCELLED,
            EXPORT_EXECUTION_STATES.PARTIAL,
          ],
        },
      },
      data: {
        status: "FAILED",
        executionState: EXPORT_EXECUTION_STATES.FAILED,
        failureStage,
        error: appendSerializedExportError(
          current.error,
          buildExportExecutionError({
            code: error?.code || "export_failed",
            stage: failureStage,
            message: error?.message || String(error || "Export failed"),
            retryable: false,
          }),
        ),
        durationMs: durationFrom(current.startedAt, now),
        completedAt: now,
        lockedAt: null,
        lockedBy: null,
      },
    });
  },

  async listStaleProcessing({ shop, now, limit = 100 }, db = prisma) {
    assertShop(shop);
    assertDate(now, "now");
    const staleBefore = new Date(now.getTime() - DEFAULT_LEASE_MS);
    return getClient(db).exportJob.findMany({
      where: {
        shop,
        status: "PROCESSING",
        executionState: {
          in: [EXPORT_EXECUTION_STATES.RUNNING, EXPORT_EXECUTION_STATES.FINALIZING],
        },
        lockedAt: { lt: staleBefore },
      },
      select: EXPORT_JOB_SELECT,
      orderBy: [{ lockedAt: "asc" }, { id: "asc" }],
      take: normalizeTake(limit),
    });
  },

  async listExpiredFiles({ shop, now, limit = 100 }, db = prisma) {
    assertShop(shop);
    assertDate(now, "now");
    return getClient(db).exportJob.findMany({
      where: {
        shop,
        fileExpiresAt: { lt: now },
        fileKey: { not: null },
      },
      select: EXPORT_JOB_SELECT,
      orderBy: [{ fileExpiresAt: "asc" }, { id: "asc" }],
      take: normalizeTake(limit),
    });
  },
};
