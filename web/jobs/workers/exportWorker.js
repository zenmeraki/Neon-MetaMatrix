import { Worker } from "bullmq";
import { connection } from "../../config/redis.js";
import ProductExportSessionService from "../../services/productService/productExportSessionService.js";
import { ProductExportService } from "../../services/productService/productExportService.js";
import { requireJobData } from "../../utils/jobPayloadValidation.js";
import logger from "../../utils/loggerUtils.js";
import {
  getJobAttempt,
  isRetryExhausted,
  recordRetryExhausted,
} from "../../utils/workerTelemetry.js";

const QUEUE_NAME = process.env.EXPORT_QUEUE || "product-export";

let exportWorkerInstance = null;

function normalizeShop(shop) {
  return String(shop || "").trim().toLowerCase();
}

function normalizeConcurrency(value) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) return 2;
  return Math.min(parsed, 10);
}

export async function processExportJob(job) {
  const { exportJobId, shop } = requireJobData(
    job,
    ["exportJobId", "shop"],
    "product export",
  );

  logger.info("Export worker started", {
    worker: "exportWorker",
    queue: QUEUE_NAME,
    jobId: job?.id,
    exportJobId,
    shop,
    attempt: getJobAttempt(job),
  });

  const session = await ProductExportSessionService.getOfflineSessionOrThrow(shop);

  if (normalizeShop(session.shop) !== normalizeShop(shop)) {
    throw new Error(
      `Offline session shop mismatch. jobShop=${shop}, sessionShop=${session.shop}`,
    );
  }

  const service = new ProductExportService(session);

  const result = await service.runExportJob({
    exportJobId,
    shop,
    workerJobId: job?.id || null,
    attempt: getJobAttempt(job),
  });

  logger.info("Export worker finished", {
    worker: "exportWorker",
    queue: QUEUE_NAME,
    jobId: job?.id,
    exportJobId,
    shop,
    operationId: result?.operationId || null,
    status: result?.status || null,
  });

  return result;
}

export function createExportWorker() {
  if (exportWorkerInstance) {
    return exportWorkerInstance;
  }

  const worker = new Worker(QUEUE_NAME, processExportJob, {
    connection,
    concurrency: normalizeConcurrency(process.env.EXPORT_WORKER_CONCURRENCY),
  });

  worker.on("failed", async (job, error) => {
    logger.error("Export worker job failed", {
      worker: "exportWorker",
      queue: QUEUE_NAME,
      jobId: job?.id,
      exportJobId: job?.data?.exportJobId,
      shop: job?.data?.shop,
      attempt: getJobAttempt(job),
      attemptsMade: job?.attemptsMade ?? 0,
      attemptsAllowed: job?.opts?.attempts ?? 1,
      message: error?.message,
      stack: error?.stack,
    });

    if (isRetryExhausted(job)) {
      await recordRetryExhausted({
        job,
        shop: job?.data?.shop,
        worker: "exportWorker",
        queue: QUEUE_NAME,
        entityType: "exportJob",
        entityId: job?.data?.exportJobId,
        executionId: job?.data?.exportJobId,
        message: "Export worker exhausted retries",
        details: {
          attempt: getJobAttempt(job),
        },
      });
    }
  });

  worker.on("error", (error) => {
    logger.error("Export worker internal error", {
      worker: "exportWorker",
      queue: QUEUE_NAME,
      message: error?.message,
      stack: error?.stack,
    });
  });

  exportWorkerInstance = worker;
  return worker;
}

export async function closeExportWorker() {
  if (!exportWorkerInstance) return;

  await exportWorkerInstance.close();
  exportWorkerInstance = null;
}

export default createExportWorker;
