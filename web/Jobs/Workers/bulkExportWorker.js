import fs from "fs";
import os from "os";
import path from "path";
import { format } from "@fast-csv/format";
import { Worker } from "bullmq";
import logger from "../../utils/loggerUtils.js";
import { connection } from "../../Config/redis.js";
import { uploadCsvToCloudinary } from "../../utils/uploadCsvToCloudinary.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
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
import { logWorkerError } from "../../utils/errorLogUtils.js";
import { recordMirrorAnomaly } from "../../services/mirrorAnomalyService.js";
import {
  EXPORT_EXECUTION_STATES,
  appendSerializedExportError,
  buildExportExecutionError,
  isTerminalExportExecutionState,
} from "../../services/exportExecutionStateService.js";

const QUEUE_NAME = process.env.EXPORT_QUEUE || "bulk-export";
const WORKER_NAME = "bulkExportWorker";

const PRODUCT_FIELD_RESOLVERS = {
  title: (p) => p.title ?? "",
  description: (p) => p.description ?? "",
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

    const updated = await tx.exportJob.updateMany({
      where: {
        id: exportJobId,
        shop,
        status: { in: ["PENDING", "FAILED"] },
        executionState: {
          in: [
            EXPORT_EXECUTION_STATES.PLANNED,
            EXPORT_EXECUTION_STATES.QUEUED,
            EXPORT_EXECUTION_STATES.FAILED,
          ],
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
}

async function finalizeExportSuccess(exportJob, fileUrl, totalRows) {
  const now = new Date();

  const updated = await prisma.exportJob.updateMany({
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
      durationMs: exportJob.startedAt
        ? Math.max(now.getTime() - new Date(exportJob.startedAt).getTime(), 0)
        : null,
      completedAt: now,
      failureStage: null,
    },
  });

  return updated.count === 1;
}

async function markFinalizing(exportJobId, shop) {
  const updated = await prisma.exportJob.updateMany({
    where: {
      id: exportJobId,
      shop,
      status: "PROCESSING",
      executionState: EXPORT_EXECUTION_STATES.RUNNING,
    },
    data: {
      executionState: EXPORT_EXECUTION_STATES.FINALIZING,
    },
  });

  return updated.count === 1;
}

const bulkExportWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { exportJobId, shop, fields, source = "export", executionId = null } = job.data || {};
    const attempt = getJobAttempt(job);

    if (!exportJobId || !shop || !executionId) {
      throw new Error("bulk export job requires exportJobId, shop, and executionId");
    }

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

      if (["terminal", "not_claimed", "finalizing", "uploaded_pending_finalize"].includes(claimResult.state)) {
        return { skipped: true, reason: claimResult.state, shop, exportJobId };
      }

      if (claimResult.state === "shop_busy") {
        throw new RetryableExportError(
          "Another export is already processing for this shop",
          "shop_export_busy",
        );
      }

      await clearKeyCaches(`${shop}:fetchExportHistories:`);

      filePath = path.join(os.tmpdir(), exportJob.filename);
      const writeStream = fs.createWriteStream(filePath);
      const csvStream = format({ headers: true });
      csvStream.pipe(writeStream);

      const pageSize = 500;
      let lastProductId = null;
      let hasMore = true;
      let totalRows = 0;

      while (hasMore) {
        const snapshotPage = await getFrozenTargetProductIds({
          ownerType: "EXPORT_JOB",
          ownerId: exportJobId,
          shop,
          limit: pageSize,
          cursorId: lastProductId,
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

          const variants = product.variants ?? [];

          if (!variants.length) {
            const row = { id: productId };

            for (const field of fields || exportJob.fields) {
              const productResolver = PRODUCT_FIELD_RESOLVERS[field];
              if (productResolver) {
                row[field] = productResolver(product);
              }
            }

            csvStream.write(row);
            totalRows += 1;
            continue;
          }

          for (let index = 0; index < variants.length; index += 1) {
            const variant = variants[index];
            const row = {
              id: productId,
              variant_id: variant.id,
            };

            for (const field of fields || exportJob.fields) {
              const productResolver = PRODUCT_FIELD_RESOLVERS[field];
              if (productResolver) {
                row[field] = index === 0 ? productResolver(product) : "";
              }

              const variantResolver = VARIANT_FIELD_RESOLVERS[field];
              if (variantResolver) {
                row[field] = variantResolver(variant);
              }
            }

            csvStream.write(row);
            totalRows += 1;
          }
        }

        lastProductId = snapshotPage.lastProductId;
        hasMore = snapshotPage.hasMore;
      }

      csvStream.end();

      await new Promise((resolve, reject) => {
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
      });

      const movedToFinalizing = await markFinalizing(exportJob.id, exportJob.shop);
      if (!movedToFinalizing) {
        throw new Error("Export could not transition to finalizing");
      }

      const fileUrl = await uploadCsvToCloudinary(
        filePath,
        exportJob.id,
        exportJob.filename,
      );

      await fs.promises.unlink(filePath).catch(() => {});
      filePath = null;

      const finalized = await finalizeExportSuccess(exportJob, fileUrl, totalRows);
      if (!finalized) {
        throw new Error("Export completion state could not be persisted safely");
      }

      await finalizeScheduledExportRunFromExportJob({
        exportJobId,
        status: "SUCCESS",
      }).catch(() => {});

      await clearKeyCaches(`${shop}:fetchExportHistories:`);

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
        }).catch(() => {});

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

      await clearKeyCaches(`${shop}:fetchExportHistories:`);

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