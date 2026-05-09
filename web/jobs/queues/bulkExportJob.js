import { Queue } from "bullmq";
import { connection } from "../../config/redis.js";
import {
  OPERATION_QUEUE_NAMES,
} from "./operationQueueRegistry.js";
import {
  buildDefaultJobOptions,
  createLazyQueueProxy,
  mergeJobOptions,
} from "../../utils/jobQueueUtils.js";
import { shopPipelineGuardService } from "../../services/execution/shopPipelineGuardService.js";
import { applyQueueBackpressure } from "./queueBackpressure.js";

const QUEUE_NAME = process.env.EXPORT_QUEUE || OPERATION_QUEUE_NAMES.EXPORT_EXECUTE;

const defaultJobOptions = buildDefaultJobOptions({
  attempts: 3,
  priority: 6,
  backoffDelay: 15_000,
  removeOnComplete: { age: 7 * 24 * 3600, count: 2_000 },
  removeOnFail: { age: 30 * 24 * 3600, count: 10_000 },
});

let bulkExportQueueInstance = null;

function getBulkExportQueue() {
  if (!bulkExportQueueInstance) {
    bulkExportQueueInstance = applyQueueBackpressure(
      new Queue(QUEUE_NAME, {
        connection,
        defaultJobOptions,
      }),
    );
  }

  return bulkExportQueueInstance;
}

export const bulkExportQueue = createLazyQueueProxy(getBulkExportQueue);

function normalizeFields(fields) {
  if (!Array.isArray(fields)) return [];
  return Array.from(
    new Set(fields.map((field) => String(field).trim()).filter(Boolean)),
  ).sort();
}

function buildBulkExportJobId({ shop, exportJobId }) {
  return `export:${shop}:${exportJobId}`;
}

export async function addbulkExportJob(data, options = {}) {
  if (!data?.exportJobId || !data?.shop || !data?.executionId) {
    throw new Error("bulk export job requires exportJobId, shop, and executionId");
  }

  await shopPipelineGuardService.assertCanQueue({
    shop: data.shop,
    pipeline: "export",
    operationId: data.exportJobId,
  });

  const normalizedData = {
    exportJobId: String(data.exportJobId),
    shop: String(data.shop),
    executionId: String(data.executionId),
    source: data.source ? String(data.source) : "export",
    fields: normalizeFields(data.fields),
  };

  return getBulkExportQueue().add(
    "bulk-export",
    normalizedData,
    mergeJobOptions(defaultJobOptions, {
      ...options,
      jobId:
        options.jobId ||
        buildBulkExportJobId(normalizedData),
    }),
  );
}

export { getBulkExportQueue };
