import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { format } from "@fast-csv/format";
import { UnrecoverableError, Worker } from "bullmq";
import logger from "../../utils/loggerUtils.js";
import { connection } from "../../config/redis.js";
import { uploadCsvToCloudinary } from "../../modules/productExports/uploadCsvToCloudinary.js";
import { clearKeyCachesBatch } from "../../utils/cacheUtils.js";
import { prisma } from "../../config/database.js";
import { finalizeScheduledExportRunFromExportJob } from "../../services/scheduledExportExecutionService.js";
import { getFrozenTargetProductIds } from "../../services/productService/productTargetingService.js";
import {
  acquireExclusiveShopWork,
  releaseExclusiveShopWork,
} from "../../services/shopWorkLeaseService.js";
import {
  getJobAttempt,
  isRetryExhausted,
  recordRetryExhausted,
} from "../../utils/workerTelemetry.js";
import { addDeadLetterJob } from "../queues/deadLetterQueue.js";
import { requireJobData } from "../../utils/jobPayloadValidation.js";
import { logWorkerError } from "../../utils/errorLogUtils.js";
import { recordMirrorAnomaly } from "../../services/mirrorAnomalyService.js";
import { assertShopMatch } from "../../utils/assertShopMatch.js";
import {
  EXPORT_EXECUTION_STATES,
  appendSerializedExportError,
  buildExportExecutionError,
  isTerminalExportExecutionState,
} from "../../services/exportExecutionStateService.js";
import { OPERATION_QUEUE_NAMES } from "../queues/operationQueueRegistry.js";
import { transitionOperation } from "../../services/operationTransitionService.js";
import { exportJobRepository } from "../../repositories/exportJobRepository.js";
import { buildCsvHeaders } from "../../modules/productExports/exportColumnAliases.js";
import {
  inferExportPresetFromFields,
  normalizeExportPreset,
} from "../../modules/productExports/exportPresets.js";
import { cloneFrozenTargetSnapshot } from "../../services/productService/productTargetingService.js";

const QUEUE_NAME = process.env.EXPORT_QUEUE || OPERATION_QUEUE_NAMES.EXPORT_EXECUTE;
const WORKER_NAME = "bulkExportWorker";

function resolveExportOperationId(exportJob) {
  if (!exportJob) return null;
  if (typeof exportJob.operationId === "string" && exportJob.operationId.trim()) {
    return exportJob.operationId.trim();
  }
  if (exportJob.scheduledExportRunId) {
    return `op_scheduled_export_run_${exportJob.scheduledExportRunId}`;
  }
  return null;
}

const PRODUCT_FIELD_RESOLVERS = {
  title: (p) => p.title ?? "",
  description: (p) => p.descriptionHtml ?? p.descriptionText ?? "",
  vendor: (p) => p.vendor ?? "",
  productType: (p) => p.productType ?? "",
  handle: (p) => p.handle ?? "",
  status: (p) => p.status ?? "",
  metaTitle: (p) => p.seoTitle ?? "",
  metaDescription: (p) => p.seoDescription ?? "",
  tags: (p) => (Array.isArray(p.tags) ? p.tags.join(", ") : ""),
  collections: (p) => {
    const raw = p.collectionsJson;
    if (!Array.isArray(raw)) return "";
    return raw.map((collection) => collection?.title).filter(Boolean).join(", ");
  },
  category: (p) => p.categoryName ?? "",
  option1Name: (p) => p.option1Name ?? "",
  option2Name: (p) => p.option2Name ?? "",
  option3Name: (p) => p.option3Name ?? "",
  googleShoppingEnabled: (p) => p.googleShoppingEnabled ?? "",
  googleShoppingAgeGroup: (p) => p.googleShoppingAgeGroup ?? "",
  googleShoppingCategory: (p) => p.googleShoppingCategory ?? "",
  googleShoppingColor: (p) => p.googleShoppingColor ?? "",
  googleShoppingCondition: (p) => p.googleShoppingCondition ?? "",
  googleShoppingCustomLabel0: (p) => p.googleShoppingCustomLabel0 ?? "",
  googleShoppingCustomLabel1: (p) => p.googleShoppingCustomLabel1 ?? "",
  googleShoppingCustomLabel2: (p) => p.googleShoppingCustomLabel2 ?? "",
  googleShoppingCustomLabel3: (p) => p.googleShoppingCustomLabel3 ?? "",
  googleShoppingCustomLabel4: (p) => p.googleShoppingCustomLabel4 ?? "",
  googleShoppingCustomProduct: (p) => p.googleShoppingCustomProduct ?? "",
  googleShoppingGender: (p) => p.googleShoppingGender ?? "",
  googleShoppingMpn: (p) => p.googleShoppingMpn ?? "",
  googleShoppingMaterial: (p) => p.googleShoppingMaterial ?? "",
  googleShoppingSize: (p) => p.googleShoppingSize ?? "",
  googleShoppingSizeSystem: (p) => p.googleShoppingSizeSystem ?? "",
  googleShoppingSizeType: (p) => p.googleShoppingSizeType ?? "",
};

const VARIANT_FIELD_RESOLVERS = {
  price: (v) => v.price ?? "",
  compareAtPrice: (v) => v.compareAtPrice ?? "",
  sku: (v) => v.sku ?? "",
  barcode: (v) => v.barcode ?? "",
  taxable: (v) => (typeof v.taxable === "boolean" ? v.taxable : ""),
  variantTitle: (v) => v.title ?? "",
  inventoryQuantity: (v) => v.inventoryQuantity ?? "",
  option1Values: (v) => v.option1Value ?? "",
  option2Values: (v) => v.option2Value ?? "",
  option3Values: (v) => v.option3Value ?? "",
};

class RetryableExportError extends Error {
  constructor(message, code = "retryable_export") {
    super(message);
    this.name = "RetryableExportError";
    this.retryable = true;
    this.code = code;
  }
}

function isRetryableError(error) {
  return Boolean(error?.retryable);
}

const MAX_ROWS = 2_000_000;
const EXPORT_LEASE_TTL_MS = Math.max(
  Number(process.env.EXPORT_LEASE_TTL_MS || 10 * 60 * 1000),
  60 * 1000,
);

async function writeCsvRow(csvStream, row) {
  if (!csvStream.write(row)) {
    await new Promise((resolve) => csvStream.once("drain", resolve));
  }
}

async function calculateFileIntegrity(filePath) {
  const hash = crypto.createHash("sha256");
  let fileSizeBytes = 0;
  const stream = fs.createReadStream(filePath);

  for await (const chunk of stream) {
    fileSizeBytes += chunk.length;
    hash.update(chunk);
  }

  return {
    checksum: hash.digest("hex"),
    fileSizeBytes,
  };
}

async function persistExportArtifact({
  exportJob,
  fileUrl,
  checksum,
  fileSizeBytes,
  rowCount,
}) {
  const operationId = resolveExportOperationId(exportJob);
  if (!operationId) return null;

  return prisma.exportArtifact.upsert({
    where: {
      shop_exportJobId: {
        shop: exportJob.shop,
        exportJobId: exportJob.id,
      },
    },
    update: {
      merchantOperationId: operationId,
      filename: exportJob.filename || null,
      fileUrl,
      downloadUrl: fileUrl,
      mimeType: "text/csv",
      fileSizeBytes,
      rowCount,
      checksum,
      status: "STORED",
      completedAt: new Date(),
    },
    create: {
      merchantOperationId: operationId,
      shop: exportJob.shop,
      exportJobId: exportJob.id,
      format: "csv",
      filename: exportJob.filename || null,
      fileUrl,
      downloadUrl: fileUrl,
      mimeType: "text/csv",
      fileSizeBytes,
      rowCount,
      checksum,
      status: "STORED",
      completedAt: new Date(),
    },
  });
}

async function finalizeScheduledRunStrict({ exportJobId, status, errorMessage = null }) {
  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await finalizeScheduledExportRunFromExportJob({
        exportJobId,
        status,
        ...(errorMessage ? { errorMessage } : {}),
      });
      return;
    } catch (error) {
      lastError = error;
      logger.error("Scheduled export run finalization attempt failed", {
        worker: WORKER_NAME,
        queue: QUEUE_NAME,
        exportJobId,
        status,
        attempt,
        message: error?.message,
      });
    }
  }

  throw new RetryableExportError(
    `Scheduled export run finalization failed after ${maxAttempts} attempts: ${lastError?.message || "unknown error"}`,
    "scheduled_export_run_finalize_failed",
  );
}

async function tryAdvisoryLock(client, lockKey) {
  const rows = await client.$queryRaw`
    SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS locked
  `;
  return Boolean(rows?.[0]?.locked);
}

async function claimExportJob(exportJobId, shop, executionId, jobId, attempt) {
  return prisma.$transaction(async (tx) => {
    const locked = await tryAdvisoryLock(tx, `bulk-export:${shop}`);
    if (!locked) {
      return { state: "shop_busy", exportJob: null };
    }

    const currentJob = await tx.exportJob.findUnique({
      where: { id: exportJobId },
    });

    if (!currentJob) {
      throw new Error("Export job not found");
    }

    assertShopMatch({
      jobShop: shop,
      dbShop: currentJob.shop,
      context: "bulk_export_claim",
      jobId,
      entityType: "exportJob",
      entityId: exportJobId,
    });

    if (
      executionId &&
      currentJob.executionIdentity &&
      executionId !== currentJob.executionIdentity
    ) {
      throw new Error("Export execution identity mismatch");
    }

    if (isTerminalExportExecutionState(currentJob.executionState) || ["COMPLETED", "FAILED", "CANCELLED", "PARTIAL"].includes(currentJob.status)) {
      return { state: "terminal", exportJob: currentJob };
    }

    if (
      currentJob.executionState === EXPORT_EXECUTION_STATES.FINALIZING &&
      currentJob.fileUrl
    ) {
      return { state: "uploaded_pending_finalize", exportJob: currentJob };
    }

    if (
      currentJob.executionState === EXPORT_EXECUTION_STATES.RUNNING &&
      currentJob.fileUrl
    ) {
      return { state: "uploaded_pending_finalize", exportJob: currentJob };
    }

    const activeExport = await tx.exportJob.findFirst({
      where: {
        shop,
        status: "PROCESSING",
        id: {
          not: exportJobId,
        },
      },
      select: { id: true },
    });

    if (activeExport) {
      return { state: "shop_busy", exportJob: currentJob };
    }

    const updated = await exportJobRepository.projectionUpdateMany({
      where: {
        id: exportJobId,
        shop,
        status: { in: ["PENDING", "FAILED"] },
        executionState: {
          in: [
            EXPORT_EXECUTION_STATES.PLANNED,
            EXPORT_EXECUTION_STATES.QUEUED,
            EXPORT_EXECUTION_STATES.FAILED,
            EXPORT_EXECUTION_STATES.FINALIZING,
          ],
        },
      },
      data: {
        status: "PROCESSING",
        executionState: EXPORT_EXECUTION_STATES.RUNNING,
        startedAt: currentJob.startedAt || new Date(),
        executionIdentity: executionId || currentJob.executionIdentity || currentJob.id,
        leaseExpiresAt: new Date(Date.now() + EXPORT_LEASE_TTL_MS),
        heartbeatAt: new Date(),
        error: null,
        failureStage: null,
      },
      reason: "bulk_export_claim_running",
    }, tx);

    if (updated.count !== 1) {
      return { state: "not_claimed", exportJob: currentJob };
    }

    const claimedJob = await exportJobRepository.projectionUpdate({
      where: { id: exportJobId },
      data: {
        error: null,
        startedAt: currentJob.startedAt || new Date(),
        executionIdentity: executionId || currentJob.executionIdentity || currentJob.id,
        leaseExpiresAt: new Date(Date.now() + EXPORT_LEASE_TTL_MS),
        heartbeatAt: new Date(),
      },
      reason: "bulk_export_claim_touch",
    }, tx);

    return {
      state: "claimed",
      exportJob: {
        ...claimedJob,
        dispatchJobId: jobId,
        dispatchAttempt: attempt,
      },
    };
  });
}

async function markExportRetryable(exportJobId, shop, error, attempt, details = {}) {
  const exportJob = await prisma.exportJob.findFirst({
    where: { id: exportJobId, shop },
    select: { error: true },
  });

  if (!exportJob) return;

  await exportJobRepository.projectionUpdateMany({
    where: {
      id: exportJobId,
      shop,
      status: "PROCESSING",
      executionState: EXPORT_EXECUTION_STATES.RUNNING,
      fileUrl: null,
    },
    data: {
      status: "PENDING",
      executionState: EXPORT_EXECUTION_STATES.QUEUED,
      failureStage: error.code || "retryable",
      leaseExpiresAt: null,
      heartbeatAt: null,
      error: appendSerializedExportError(
        exportJob.error,
        buildExportExecutionError({
          code: error.code || "retryable_export",
          stage: "worker_execution",
          message: error.message,
          retryable: true,
          details: {
            attempt,
            ...details,
          },
        }),
      ),
    },
    reason: "bulk_export_retryable_requeue",
  });

  const opId = resolveExportOperationId({ id: exportJobId, shop, scheduledExportRunId: details?.scheduledExportRunId || null });
  if (opId) {
    await transitionOperation({
      shop,
      operationId: opId,
      from: "DISPATCHING",
      to: "SNAPSHOTTED",
      data: {
        errorCode: error.code || "retryable_export",
        errorMessage: error.message,
      },
    });
  }
}

async function markExportFailure(exportJobId, shop, error, attempt, source, executionId) {
  const exportJob = await prisma.exportJob.findFirst({
    where: { id: exportJobId, shop },
    select: { error: true },
  });

  await exportJobRepository.projectionUpdateMany({
    where: {
      id: exportJobId,
      shop,
      executionState: {
        in: [EXPORT_EXECUTION_STATES.RUNNING, EXPORT_EXECUTION_STATES.FINALIZING],
      },
    },
    data: {
      status: "FAILED",
      executionState: EXPORT_EXECUTION_STATES.FAILED,
      failureStage: "export_worker",
      leaseExpiresAt: null,
      heartbeatAt: null,
      error: appendSerializedExportError(
        exportJob?.error,
        buildExportExecutionError({
          code: error.code || "bulk_export_worker_failure",
          stage: "export_worker",
          message: error.message,
          retryable: false,
          details: {
            stack: error.stack || null,
            attempt,
            source,
            executionId,
          },
        }),
      ),
      completedAt: new Date(),
    },
    reason: "bulk_export_mark_failed",
  }).catch(() => {});

  const exportJobMeta = await prisma.exportJob.findUnique({
    where: { id: exportJobId },
    select: { operationId: true, scheduledExportRunId: true, shop: true },
  }).catch(() => null);
  const opId = resolveExportOperationId(exportJobMeta);
  if (opId) {
    await transitionOperation({
      shop,
      operationId: opId,
      from: "APPLYING_RESULTS",
      to: "FAILED",
      data: {
        failedAt: new Date(),
        errorCode: error.code || "bulk_export_worker_failure",
        errorMessage: error.message,
      },
    });
  }
}

async function finalizeExportSuccess(exportJob, fileUrl, totalRows) {
  const now = new Date();

  const updated = await exportJobRepository.projectionUpdateMany({
    where: {
      id: exportJob.id,
      shop: exportJob.shop,
      status: "PROCESSING",
      executionState: {
        in: [EXPORT_EXECUTION_STATES.RUNNING, EXPORT_EXECUTION_STATES.FINALIZING],
      },
    },
    data: {
      executionState: EXPORT_EXECUTION_STATES.COMPLETED,
      status: "COMPLETED",
      fileUrl,
      totalItems: totalRows,
      lastProcessedOrdinal: 0,
      durationMs: exportJob.startedAt
        ? Math.max(now.getTime() - new Date(exportJob.startedAt).getTime(), 0)
        : null,
      completedAt: now,
      failureStage: null,
      leaseExpiresAt: null,
      heartbeatAt: now,
    },
    reason: "bulk_export_finalize_success",
  });

  const opId = resolveExportOperationId(exportJob);
  if (updated.count === 1 && opId) {
    await transitionOperation({
      shop: exportJob.shop,
      operationId: opId,
      from: "APPLYING_RESULTS",
      to: "COMPLETED",
      data: {
        completedAt: now,
        totalItems: Number(totalRows || 0),
        processedItems: Number(totalRows || 0),
        failedItems: 0,
      },
    });
  }

  return updated.count === 1;
}

async function markFinalizing(exportJobId, shop) {
  const job = await prisma.exportJob.findUnique({
    where: { id: exportJobId },
    select: { operationId: true, scheduledExportRunId: true, shop: true },
  }).catch(() => null);
  const opId = resolveExportOperationId(job);
  if (opId) {
    await transitionOperation({
      shop,
      operationId: opId,
      from: "DISPATCHING",
      to: "APPLYING_RESULTS",
    });
  }

  const updated = await exportJobRepository.projectionUpdateMany({
    where: {
      id: exportJobId,
      shop,
      status: "PROCESSING",
      executionState: EXPORT_EXECUTION_STATES.RUNNING,
      fileUrl: null,
    },
    data: {
      executionState: EXPORT_EXECUTION_STATES.FINALIZING,
      leaseExpiresAt: new Date(Date.now() + EXPORT_LEASE_TTL_MS),
      heartbeatAt: new Date(),
    },
    reason: "bulk_export_mark_finalizing",
  });

  return updated.count === 1;
}

async function refreshExportLease({ exportJobId, shop, executionId }) {
  await exportJobRepository.projectionUpdateMany({
    where: {
      id: exportJobId,
      shop,
      executionState: {
        in: [EXPORT_EXECUTION_STATES.RUNNING, EXPORT_EXECUTION_STATES.FINALIZING],
      },
      ...(executionId ? { executionIdentity: executionId } : {}),
    },
    data: {
      heartbeatAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + EXPORT_LEASE_TTL_MS),
    },
    reason: "bulk_export_lease_heartbeat",
  });
}

async function ensureFrozenSnapshot({ exportJob, shop, executionId }) {
  if (Number(exportJob?.targetSnapshotCount || 0) > 0) {
    return Number(exportJob.targetSnapshotCount || 0);
  }

  let parsed = null;
  try {
    parsed = JSON.parse(String(exportJob?.filterQuery || "{}"));
  } catch {
    parsed = null;
  }
  const sourceOwnerType = parsed?.freeze?.sourceOwnerType;
  const sourceOwnerId = parsed?.freeze?.sourceOwnerId;
  if (!sourceOwnerType || !sourceOwnerId) {
    throw new Error("EXPORT_FREEZE_SOURCE_MISSING");
  }

  const frozen = await cloneFrozenTargetSnapshot({
    sourceOwnerType,
    sourceOwnerId,
    targetOwnerType: "EXPORT_JOB",
    targetOwnerId: exportJob.id,
    shop,
  });
  const frozenCount = Number(frozen?.count || 0);

  await exportJobRepository.projectionUpdateMany({
    where: {
      id: exportJob.id,
      shop,
      ...(executionId ? { executionIdentity: executionId } : {}),
    },
    data: {
      targetSnapshotCount: frozenCount,
      executionState: EXPORT_EXECUTION_STATES.QUEUED,
      heartbeatAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + EXPORT_LEASE_TTL_MS),
    },
    reason: "bulk_export_freeze_complete_projection",
  });

  const opId = resolveExportOperationId(exportJob);
  if (opId) {
    await transitionOperation({
      shop,
      operationId: opId,
      from: "SNAPSHOTTING",
      to: "SNAPSHOTTED",
      data: {
        totalItems: frozenCount,
      },
    });
  }

  return frozenCount;
}

const bulkExportWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const data = requireJobData(
      job,
      ["exportJobId", "shop", "executionId"],
      "bulk export",
    );
    const {
      exportJobId,
      shop,
      fields,
      preset: requestedPreset = null,
      source = "export",
      executionId = null,
    } = data;
    const attempt = getJobAttempt(job);

    let filePath = null;
    let shopLockKey = null;

    try {
      const lock = await acquireExclusiveShopWork({
        shop,
        activity: "bulk_export_execution",
        worker: WORKER_NAME,
        queue: QUEUE_NAME,
        jobId: job.id,
        entityType: "exportJob",
        entityId: exportJobId,
        executionId,
      });

      if (!lock.acquired) {
        throw new RetryableExportError(
          "Another heavy job is already running for this shop",
          "shop_work_conflict",
        );
      }

      shopLockKey = lock.lockKey;

      const claimResult = await claimExportJob(exportJobId, shop, executionId, job.id, attempt);
      const exportJob = claimResult.exportJob;

      if (!exportJob) {
        throw new Error("Export job not found");
      }

      if (["terminal", "not_claimed", "uploaded_pending_finalize"].includes(claimResult.state)) {
        if (
          exportJob?.scheduledExportRunId &&
          ["COMPLETED", "FAILED", "CANCELLED", "PARTIAL"].includes(exportJob?.status)
        ) {
          await finalizeScheduledRunStrict({
            exportJobId,
            status: exportJob.status === "COMPLETED" ? "SUCCESS" : "FAILED",
            errorMessage: exportJob.status === "COMPLETED" ? null : "Export job ended before scheduled run finalization",
          });
        }
        return { skipped: true, reason: claimResult.state, shop, exportJobId };
      }

      if (claimResult.state === "shop_busy") {
        if (exportJob?.scheduledExportRunId) {
          throw new RetryableExportError(
            "Another export is already processing for this shop",
            "shop_busy_retry_scheduled_export",
          );
        }

        await exportJobRepository.projectionUpdateMany({
          where: {
            id: exportJobId,
            shop,
            status: { in: ["PENDING", "PROCESSING"] },
          },
          data: {
            status: "CANCELLED",
            executionState: EXPORT_EXECUTION_STATES.CANCELLED,
            failureStage: "duplicate_export_blocked",
            error: appendSerializedExportError(
              null,
              buildExportExecutionError({
                code: "duplicate_export_blocked",
                stage: "claim",
                message: "Another export is already processing for this shop",
                retryable: false,
              })
            ),
            completedAt: new Date(),
          },
          reason: "bulk_export_cancel_duplicate",
        });

        return {
          skipped: true,
          reason: "duplicate_export_blocked",
          shop,
          exportJobId,
        };
      }

      if (!exportJob.targetMirrorBatchId) {
        const error = new UnrecoverableError("EXPORT_TARGET_MIRROR_BATCH_REQUIRED");
        error.code = "EXPORT_TARGET_MIRROR_BATCH_REQUIRED";
        throw error;
      }

      await ensureFrozenSnapshot({ exportJob, shop, executionId });
      await refreshExportLease({ exportJobId, shop, executionId });

      await clearKeyCachesBatch([`${shop}:fetchExportHistories:`]);

      filePath = path.join(
        os.tmpdir(),
        `${exportJob.id}-${Date.now()}-${exportJob.filename}`,
      );
      const writeStream = fs.createWriteStream(filePath);
const selectedFields =
  Array.isArray(fields) && fields.length ? fields : exportJob.fields;
const resolvedPreset = requestedPreset
  ? normalizeExportPreset(requestedPreset)
  : inferExportPresetFromFields(selectedFields);

const includeVariantId = selectedFields.some((f) => VARIANT_FIELD_RESOLVERS[f]);
const csvHeaders = buildCsvHeaders(selectedFields, {
  includeVariantId,
  preset: resolvedPreset,
});

const csvStream = format({
  headers: csvHeaders,
});
      csvStream.pipe(writeStream);

      const pageSize = 500;
      let lastOrdinal = Math.max(
        0,
        Number.parseInt(exportJob.lastProcessedOrdinal ?? 0, 10) || 0,
      );
      let hasMore = true;
      let totalRows = 0;

      while (hasMore) {
        const snapshotPage = await getFrozenTargetProductIds({
          ownerType: "EXPORT_JOB",
          ownerId: exportJobId,
          shop,
          limit: pageSize,
          cursorOrdinal: lastOrdinal,
        });

        const productIds = snapshotPage.rows.map((row) => row.productId);
        if (!productIds.length) {
          break;
        }

        const products = await prisma.product.findMany({
          where: {
            shop,
            id: { in: productIds },
            mirrorBatchId: exportJob.targetMirrorBatchId,
          },
          orderBy: {
            id: "asc",
          },
          include: {
            variants: {
              orderBy: { id: "asc" },
            },
          },
        });

        if (productIds.length !== products.length) {
          const driftError = new UnrecoverableError("SNAPSHOT_DRIFT_DETECTED");
          driftError.code = "SNAPSHOT_DRIFT_DETECTED";
          throw driftError;
        }

        const productMap = new Map(products.map((product) => [product.id, product]));
        const missingProductIds = productIds.filter((productId) => !productMap.has(productId));
        if (missingProductIds.length > 0) {
          const error = new UnrecoverableError(
            "Frozen snapshot integrity violated: products missing from active mirror batch",
          );
          error.code = "FROZEN_TARGET_PRODUCTS_MISSING_FROM_MIRROR";
          error.details = {
            exportJobId,
            mirrorBatchId: exportJob.targetMirrorBatchId || null,
            missingCount: missingProductIds.length,
            missingProductIds: missingProductIds.slice(0, 20),
          };
          throw error;
        }

        for (const productId of productIds) {
          const product = productMap.get(productId);
          if (!product) continue;

          const variants = product.variants ?? [];

         if (!variants.length) {
  const row = { [csvHeaders[0]]: productId };

  if (includeVariantId) {
    row[csvHeaders[1]] = "";
  }

  for (let index = 0; index < selectedFields.length; index += 1) {
    const field = selectedFields[index];
    const header = csvHeaders[(includeVariantId ? 2 : 1) + index];
    const productResolver = PRODUCT_FIELD_RESOLVERS[field];
    row[header] = productResolver ? productResolver(product) : "";
  }

  await writeCsvRow(csvStream, row);
  totalRows += 1;
  if (totalRows > MAX_ROWS) {
    const tooLargeError = new Error("EXPORT_TOO_LARGE");
    tooLargeError.code = "EXPORT_TOO_LARGE";
    throw tooLargeError;
  }
  continue;
}

         for (let index = 0; index < variants.length; index += 1) {
  const variant = variants[index];

  const row = {
    [csvHeaders[0]]: productId,
  };

  if (includeVariantId) {
    row[csvHeaders[1]] = variant.id;
  }

  for (let fieldIndex = 0; fieldIndex < selectedFields.length; fieldIndex += 1) {
    const field = selectedFields[fieldIndex];
    const header = csvHeaders[(includeVariantId ? 2 : 1) + fieldIndex];
    const productResolver = PRODUCT_FIELD_RESOLVERS[field];
    const variantResolver = VARIANT_FIELD_RESOLVERS[field];

    if (variantResolver) {
      row[header] = variantResolver(variant);
    } else if (productResolver) {
      row[header] = index === 0 ? productResolver(product) : "";
    } else {
      row[header] = "";
    }
  }

  await writeCsvRow(csvStream, row);
  totalRows += 1;
  if (totalRows > MAX_ROWS) {
    const tooLargeError = new Error("EXPORT_TOO_LARGE");
    tooLargeError.code = "EXPORT_TOO_LARGE";
    throw tooLargeError;
  }
}
        }

        lastOrdinal = snapshotPage.lastOrdinal;
        await exportJobRepository.projectionUpdateMany({
          where: {
            id: exportJob.id,
            shop: exportJob.shop,
            status: "PROCESSING",
            executionState: EXPORT_EXECUTION_STATES.RUNNING,
          },
          data: {
            lastProcessedOrdinal: lastOrdinal,
            heartbeatAt: new Date(),
            leaseExpiresAt: new Date(Date.now() + EXPORT_LEASE_TTL_MS),
          },
          reason: "bulk_export_checkpoint",
        });
        await refreshExportLease({ exportJobId, shop, executionId });
        hasMore = snapshotPage.hasMore;
      }

      csvStream.end();

      await new Promise((resolve, reject) => {
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
      });

      const integrity = await calculateFileIntegrity(filePath);
      if (integrity.fileSizeBytes <= 0) {
        const emptyArtifactError = new Error("EXPORT_ARTIFACT_EMPTY");
        emptyArtifactError.code = "EXPORT_ARTIFACT_EMPTY";
        throw emptyArtifactError;
      }

      const movedToFinalizing = await markFinalizing(exportJob.id, exportJob.shop);
      if (!movedToFinalizing) {
        throw new Error("Export could not transition to finalizing");
      }

      const fileUrl = await uploadCsvToCloudinary(
        filePath,
        exportJob.id,
        exportJob.filename,
      );

      const artifact = await persistExportArtifact({
        exportJob,
        fileUrl,
        checksum: integrity.checksum,
        fileSizeBytes: integrity.fileSizeBytes,
        rowCount: totalRows,
      });

      await fs.promises.unlink(filePath).catch(() => {});
      filePath = null;

      const finalized = await finalizeExportSuccess(exportJob, fileUrl, totalRows);
      if (!finalized) {
        throw new Error("Export completion state could not be persisted safely");
      }

      await finalizeScheduledRunStrict({
        exportJobId,
        status: "SUCCESS",
      });

      await clearKeyCachesBatch([`${shop}:fetchExportHistories:`]);

      logger.info("Bulk export worker completed export generation", {
        worker: WORKER_NAME,
        queue: QUEUE_NAME,
        jobId: job.id,
        shop,
        exportJobId,
        executionId,
        attempt,
        totalRows,
        checksum: integrity.checksum,
        fileSizeBytes: integrity.fileSizeBytes,
        artifactId: artifact?.id || null,
        source,
      });

      return {
        success: true,
        exportJobId,
        totalRows,
        shop,
        checksum: integrity.checksum,
        artifactId: artifact?.id || null,
      };
    } catch (error) {
      logger.error("Bulk export worker failed during execution", {
        worker: WORKER_NAME,
        queue: QUEUE_NAME,
        jobId: job?.id,
        shop,
        exportJobId,
        executionId,
        attempt,
        message: error.message,
        source,
      });

      if (isRetryableError(error)) {
        await markExportRetryable(exportJobId, shop, error, attempt, {
          source,
          worker: WORKER_NAME,
          queue: QUEUE_NAME,
          jobId: job?.id || null,
          executionId,
        }).catch(() => {});
      } else {
        await markExportFailure(exportJobId, shop, error, attempt, source, executionId);

        await finalizeScheduledRunStrict({
          exportJobId,
          status: "FAILED",
          errorMessage: error.message,
        });

        await recordMirrorAnomaly({
          shop,
          severity: "high",
          type: "bulk_export_worker_failure",
          entityType: "exportJob",
          entityId: exportJobId,
          message: error.message,
          details: {
            worker: WORKER_NAME,
            queue: QUEUE_NAME,
            jobId: job?.id || null,
            executionId,
            attempt,
            source,
          },
        }).catch(() => {});
      }

      await clearKeyCachesBatch([`${shop}:fetchExportHistories:`]);

      if (filePath) {
        await fs.promises.unlink(filePath).catch(() => {});
      }

      await logWorkerError({
        shop,
        err: error,
        source: "bulkExportWorker",
        metadata: {
          queue: QUEUE_NAME,
          worker: WORKER_NAME,
          jobId: job?.id || null,
          exportJobId,
          executionId,
          attempt,
          source,
          retryable: isRetryableError(error),
        },
      });

      throw error;
    } finally {
      await releaseExclusiveShopWork(shopLockKey);
    }
  },
  { connection, concurrency: 1 },
);

bulkExportWorker.on("failed", async (job, error) => {
  logger.error("Bulk export worker failed job", {
    worker: WORKER_NAME,
    queue: QUEUE_NAME,
    jobId: job?.id,
    shop: job?.data?.shop,
    exportJobId: job?.data?.exportJobId,
    executionId: job?.data?.executionId || null,
    attempt: getJobAttempt(job),
    message: error.message,
  });

  if (isRetryExhausted(job)) {
    await addDeadLetterJob("bulk_export_failed", {
      job,
      error,
      reason: "bulk_export_retries_exhausted",
    }).catch(() => {});

    await recordRetryExhausted({
      job,
      shop: job?.data?.shop,
      worker: WORKER_NAME,
      queue: QUEUE_NAME,
      entityType: "exportJob",
      entityId: job?.data?.exportJobId,
      executionId: job?.data?.executionId || null,
      message: "Bulk export worker exhausted retries",
      details: {
        source: job?.data?.source || null,
      },
    });
  }
});

export default bulkExportWorker;
