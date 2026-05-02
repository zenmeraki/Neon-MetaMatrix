import fs from "fs";
import os from "os";
import path from "path";
import { format } from "@fast-csv/format";
import { Worker } from "bullmq";
import logger from "../../utils/loggerUtils.js";
import { connection } from "../../Config/redis.js";
import { uploadCsvToCloudinary } from "../../utils/uploadCsvToCloudinary.js";
import { clearKeyCachesBatch } from "../../utils/cacheUtils.js";
import { prisma } from "../../config/database.js";
import { exportJobRepository } from "../../repositories/exportJobRepository.js";
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
import { requireJobData } from "../../utils/jobPayloadValidation.js";
import { logWorkerError } from "../../utils/errorLogUtils.js";
import { recordMirrorAnomaly } from "../../services/mirrorAnomalyService.js";
import {
  EXPORT_EXECUTION_STATES,
  appendSerializedExportError,
  buildExportExecutionError,
  isTerminalExportExecutionState,
} from "../../services/exportExecutionStateService.js";
import { assertValidTransition } from "../../services/execution/executionStateMachine.js";
import { storeExecutionLockService } from "../../services/execution/storeExecutionLockService.js";

const QUEUE_NAME = process.env.EXPORT_QUEUE || "bulk-export";
const WORKER_NAME = "bulkExportWorker";

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
};

const VARIANT_FIELD_RESOLVERS = {
  price: (v) => v.price ?? "",
  compareAtPrice: (v) => v.compareAtPrice ?? "",
  sku: (v) => v.sku ?? "",
  barcode: (v) => v.barcode ?? "",
  taxable: (v) => (typeof v.taxable === "boolean" ? v.taxable : ""),
  variantTitle: (v) => v.title ?? "",
  inventoryQuantity: (v) => v.inventoryQuantity ?? "",
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

async function tryAdvisoryLock(client, lockKey, transactional = true) {
  if (transactional) {
    const rows = await client.$queryRaw`
      SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS locked
    `;
    return Boolean(rows?.[0]?.locked);
  }

  const rows = await client.$queryRaw`
    SELECT pg_try_advisory_lock(hashtext(${lockKey})) AS locked
  `;
  return Boolean(rows?.[0]?.locked);
}

async function claimExportJob(exportJobId, shop, executionId, jobId, attempt) {
  return prisma.$transaction(async (tx) => {
    const locked = await tryAdvisoryLock(tx, `bulk-export:${shop}`, true);
    if (!locked) {
      return { state: "shop_busy", exportJob: null };
    }

    const currentJob = await tx.exportJob.findUnique({
      where: { id: exportJobId },
    });

    if (!currentJob) {
      throw new Error("Export job not found");
    }

    if (currentJob.shop !== shop) {
      throw new Error("Cross-shop export execution blocked");
    }

    if (executionId && executionId !== currentJob.id) {
      throw new Error("Export execution identity mismatch");
    }

    if (isTerminalExportExecutionState(currentJob.executionState) || ["COMPLETED", "FAILED", "CANCELLED", "PARTIAL"].includes(currentJob.status)) {
      return { state: "terminal", exportJob: currentJob };
    }

    if (currentJob.executionState === EXPORT_EXECUTION_STATES.FINALIZING) {
      return { state: "finalizing", exportJob: currentJob };
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

    if (currentJob.executionState === EXPORT_EXECUTION_STATES.FAILED) {
      assertValidTransition({
        from: EXPORT_EXECUTION_STATES.FAILED,
        to: EXPORT_EXECUTION_STATES.QUEUED,
      });

      await tx.exportJob.updateMany({
        where: {
          id: exportJobId,
          shop,
          executionState: EXPORT_EXECUTION_STATES.FAILED,
        },
        data: {
          status: "PENDING",
          executionState: EXPORT_EXECUTION_STATES.QUEUED,
        },
      });
    }

    if (currentJob.executionState === EXPORT_EXECUTION_STATES.PLANNED) {
      assertValidTransition({
        from: EXPORT_EXECUTION_STATES.PLANNED,
        to: EXPORT_EXECUTION_STATES.QUEUED,
      });

      await tx.exportJob.updateMany({
        where: {
          id: exportJobId,
          shop,
          executionState: EXPORT_EXECUTION_STATES.PLANNED,
        },
        data: {
          executionState: EXPORT_EXECUTION_STATES.QUEUED,
        },
      });
    }

    assertValidTransition({
      from: EXPORT_EXECUTION_STATES.QUEUED,
      to: EXPORT_EXECUTION_STATES.RUNNING,
    });

    const updated = await tx.exportJob.updateMany({
      where: {
        id: exportJobId,
        shop,
        status: { in: ["PENDING"] },
        executionState: {
          in: [EXPORT_EXECUTION_STATES.QUEUED],
        },
      },
      data: {
        status: "PROCESSING",
        executionState: EXPORT_EXECUTION_STATES.RUNNING,
        startedAt: currentJob.startedAt || new Date(),
        error: null,
        failureStage: null,
      },
    });

    if (updated.count !== 1) {
      return { state: "not_claimed", exportJob: currentJob };
    }

    const claimedJob = await tx.exportJob.update({
      where: { id: exportJobId },
      data: {
        error: null,
        startedAt: currentJob.startedAt || new Date(),
      },
    });

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

  await prisma.exportJob.updateMany({
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
  });
}

async function markExportFailure(exportJobId, shop, error, attempt, source, executionId) {
  await exportJobRepository.markFailed({
    id: exportJobId,
    shop,
    error,
    failureStage: "export_worker",
    now: new Date(),
  }).catch(async () => {
    const exportJob = await prisma.exportJob.findFirst({
      where: { id: exportJobId, shop },
      select: { error: true },
    });

    await prisma.exportJob.updateMany({
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
    }).catch(() => {});
  });
}

async function finalizeExportSuccess(exportJob, fileUrl, totalRows, productCount, fileSizeBytes) {
  const now = new Date();

  const updated = await exportJobRepository.markCompleted({
    id: exportJob.id,
    shop: exportJob.shop,
    fileKey: `product-exports/${exportJob.filename.replace(/\.csv$/i, "").trim().replace(/\s+/g, "-")}`,
    fileUrl,
    fileName: exportJob.filename,
    mimeType: "text/csv",
    fileSizeBytes,
    rowCount: totalRows,
    productCount,
    mirrorBatchId: exportJob.targetMirrorBatchId,
    now,
  });

  return updated.count === 1;
}

async function markFinalizing(exportJobId, shop) {
  const updated = await exportJobRepository.markFinalizing({
    id: exportJobId,
    shop,
    now: new Date(),
  });

  return updated.count === 1;
}

const bulkExportWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const data = requireJobData(
      job,
      ["exportJobId", "shop", "executionId"],
      "bulk export",
    );
    const { exportJobId, shop, fields, source = "export", executionId = null } = data;
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

      const writeLock = await storeExecutionLockService.acquireWriteLock({
        shop,
        operationId: exportJobId,
      });

      if (!writeLock.acquired) {
        throw new RetryableExportError(
          `Conflicting write operation is active: ${writeLock.reason}`,
          "store_write_conflict",
        );
      }

      const claimResult = await claimExportJob(exportJobId, shop, executionId, job.id, attempt);
      const exportJob = claimResult.exportJob;

      if (!exportJob) {
        throw new Error("Export job not found");
      }

      if (["terminal", "not_claimed", "finalizing", "uploaded_pending_finalize"].includes(claimResult.state)) {
        return { skipped: true, reason: claimResult.state, shop, exportJobId };
      }

      if (claimResult.state === "shop_busy") {
  await prisma.exportJob.updateMany({
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
  });

  return {
    skipped: true,
    reason: "duplicate_export_blocked",
    shop,
    exportJobId,
  };
}

      await clearKeyCachesBatch([`${shop}:fetchExportHistories:`]);

      filePath = path.join(os.tmpdir(), exportJob.filename);
      const writeStream = fs.createWriteStream(filePath);
      const selectedFields =
  Array.isArray(fields) && fields.length ? fields : exportJob.fields;

const csvHeaders = ["id"];

if (selectedFields.some((f) => VARIANT_FIELD_RESOLVERS[f])) {
  csvHeaders.push("variant_id");
}

csvHeaders.push(...selectedFields);

const csvStream = format({
  headers: csvHeaders,
});
      csvStream.pipe(writeStream);

      const pageSize = 500;
      let lastOrdinal = 0;
      let hasMore = true;
      let totalRows = 0;
      let totalProducts = 0;

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
            ...(exportJob.targetMirrorBatchId
              ? { mirrorBatchId: exportJob.targetMirrorBatchId }
              : {}),
          },
          include: {
            variants: {
              orderBy: { id: "asc" },
            },
          },
        });

        const productMap = new Map(products.map((product) => [product.id, product]));

        for (const productId of productIds) {
          const product = productMap.get(productId);
          if (!product) continue;
          totalProducts += 1;

          const variants = product.variants ?? [];

         if (!variants.length) {
  const row = { id: productId };

  if (csvHeaders.includes("variant_id")) {
    row.variant_id = "";
  }

  for (const field of selectedFields) {
    const productResolver = PRODUCT_FIELD_RESOLVERS[field];
    row[field] = productResolver ? productResolver(product) : "";
  }

  csvStream.write(row);
  totalRows += 1;
  continue;
}

         for (let index = 0; index < variants.length; index += 1) {
  const variant = variants[index];

  const row = {
    id: productId,
  };

  if (csvHeaders.includes("variant_id")) {
    row.variant_id = variant.id;
  }

  for (const field of selectedFields) {
    const productResolver = PRODUCT_FIELD_RESOLVERS[field];
    const variantResolver = VARIANT_FIELD_RESOLVERS[field];

    if (variantResolver) {
      row[field] = variantResolver(variant);
    } else if (productResolver) {
      row[field] = index === 0 ? productResolver(product) : "";
    } else {
      row[field] = "";
    }
  }

  csvStream.write(row);
  totalRows += 1;
}
        }

        lastOrdinal = snapshotPage.lastOrdinal;
        hasMore = snapshotPage.hasMore;
      }

      csvStream.end();

      await new Promise((resolve, reject) => {
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
      });

      assertValidTransition({
        from: EXPORT_EXECUTION_STATES.RUNNING,
        to: EXPORT_EXECUTION_STATES.FINALIZING,
      });

      const movedToFinalizing = await markFinalizing(exportJob.id, exportJob.shop);
      if (!movedToFinalizing) {
        throw new Error("Export could not transition to finalizing");
      }

      const fileSizeBytes = (await fs.promises.stat(filePath)).size;
      const fileUrl = await uploadCsvToCloudinary(
        filePath,
        exportJob.id,
        exportJob.filename,
      );

      await fs.promises.unlink(filePath).catch(() => {});
      filePath = null;

      assertValidTransition({
        from: EXPORT_EXECUTION_STATES.FINALIZING,
        to: EXPORT_EXECUTION_STATES.COMPLETED,
      });

      const finalized = await finalizeExportSuccess(
        exportJob,
        fileUrl,
        totalRows,
        totalProducts,
        fileSizeBytes,
      );
      if (!finalized) {
        throw new Error("Export completion state could not be persisted safely");
      }

      await finalizeScheduledExportRunFromExportJob({
  exportJobId,
  status: "SUCCESS",
}).catch((err) => {
  logger.error("Failed to finalize scheduled export run", {
    exportJobId,
    shop,
    error: err.message,
    stack: err.stack,
  });
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
        source,
      });

      return {
        success: true,
        exportJobId,
        totalRows,
        shop,
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

        await finalizeScheduledExportRunFromExportJob({
  exportJobId,
  status: "FAILED",
  errorMessage: error.message,
}).catch((err) => {
  logger.error("Failed to finalize scheduled export run on failure", {
    exportJobId,
    shop,
    error: err.message,
  });
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
