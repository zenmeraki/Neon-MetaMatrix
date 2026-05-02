import os from "os";
import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import logger from "../../utils/loggerUtils.js";
import { logWorkerError } from "../../utils/errorLogUtils.js";
import { getJobAttempt } from "../../utils/workerTelemetry.js";
import { productBulkIngestionService } from "../../services/sync/productBulkIngestionService.js";

const QUEUE_NAME =
  process.env.PRODUCT_BULK_INGESTION_QUEUE || "product-bulk-ingestion";

const WORKER_NAME = "productBulkIngestionWorker";
const WORKER_ID = `${os.hostname()}:${process.pid}`;

export const productBulkIngestionWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { shop, syncHistoryId, bulkOperationId } = job.data || {};

    if (!shop || !syncHistoryId || !bulkOperationId) {
      throw new Error(
        "product bulk ingestion job requires shop, syncHistoryId, and bulkOperationId",
      );
    }

    return productBulkIngestionService.ingestCompletedBulkOperation({
      shop,
      syncHistoryId,
      bulkOperationId,
      workerId: WORKER_ID,
    });
  },
  {
    connection,
    concurrency: Number(process.env.PRODUCT_BULK_INGESTION_CONCURRENCY || 1),
    lockDuration: 300_000,
    stalledInterval: 60_000,
    maxStalledCount: 1,
  },
);

productBulkIngestionWorker.on("completed", (job, result) => {
  logger.info("Product bulk ingestion completed", {
    worker: WORKER_NAME,
    queue: QUEUE_NAME,
    workerId: WORKER_ID,
    jobId: job?.id,
    shop: job?.data?.shop,
    syncHistoryId: job?.data?.syncHistoryId,
    bulkOperationId: job?.data?.bulkOperationId,
    result,
  });
});

productBulkIngestionWorker.on("failed", async (job, error) => {
  logger.error("Product bulk ingestion failed", {
    worker: WORKER_NAME,
    queue: QUEUE_NAME,
    workerId: WORKER_ID,
    jobId: job?.id,
    shop: job?.data?.shop,
    syncHistoryId: job?.data?.syncHistoryId,
    bulkOperationId: job?.data?.bulkOperationId,
    attempt: getJobAttempt(job),
    message: error.message,
  });

  await logWorkerError({
    shop: job?.data?.shop,
    err: error,
    source: WORKER_NAME,
    metadata: {
      queue: QUEUE_NAME,
      worker: WORKER_NAME,
      jobId: job?.id,
      syncHistoryId: job?.data?.syncHistoryId,
      bulkOperationId: job?.data?.bulkOperationId,
    },
  }).catch(() => {});
});

productBulkIngestionWorker.on("error", (error) => {
  logger.error("Product bulk ingestion worker error", {
    worker: WORKER_NAME,
    queue: QUEUE_NAME,
    workerId: WORKER_ID,
    message: error.message,
  });
});
