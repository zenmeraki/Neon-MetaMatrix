import { Queue } from "bullmq";
import { connection } from "../../config/redis.js";
import {
  OPERATION_QUEUE_NAMES,
  buildOperationJobId,
} from "./operationQueueRegistry.js";
import {
  buildDefaultJobOptions,
  createLazyQueueProxy,
  mergeJobOptions,
} from "../../utils/jobQueueUtils.js";
import { applyQueueBackpressure } from "./queueBackpressure.js";
import { shopPipelineGuardService } from "../../services/execution/shopPipelineGuardService.js";
import { prisma } from "../../config/database.js";
import { stableHash } from "../../utils/idempotencyKey.js";

const QUEUE_NAME = process.env.EDIT_QUEUE || OPERATION_QUEUE_NAMES.BULK_EDIT_EXECUTE;

const defaultJobOptions = buildDefaultJobOptions({
  attempts: 3,
  priority: 7,
  backoffDelay: 30_000,
  removeOnComplete: { age: 7 * 24 * 3600, count: 2_000 },
  removeOnFail: { age: 30 * 24 * 3600, count: 10_000 },
});

let bulkEditQueueInstance = null;

function getBulkEditQueue() {
  if (!bulkEditQueueInstance) {
    bulkEditQueueInstance = applyQueueBackpressure(
      new Queue(QUEUE_NAME, {
        connection,
        defaultJobOptions,
      }),
    );
  }

  return bulkEditQueueInstance;
}

export const bulkEditQueue = createLazyQueueProxy(getBulkEditQueue);

export async function addbulkEditJob(data, options = {}) {
  if (!data?.historyId || !data?.shop || !data?.executionId || !data?.operationId) {
    throw new Error(
      "bulk edit job requires historyId, shop, executionId, and operationId"
    );
  }

  await shopPipelineGuardService.assertCanQueue({
    shop: data.shop,
    pipeline: "edit",
    operationId: data.operationId,
  });

  let intentId = data.intentId || null;
  let executionPlanId = data.executionPlanId || null;
  if (!intentId) {
    const history = await prisma.editHistory.findFirst({
      where: { id: data.historyId, shop: data.shop },
      select: { summary: true, batch: true },
    });
    const summaryIntentId =
      typeof history?.summary?.intentId === "string" ? history.summary.intentId : null;
    const batchIntentId =
      typeof history?.batch?.intentId === "string" ? history.batch.intentId : null;
    const intent = history?.summary?.bulkEditIntent || null;

    intentId =
      summaryIntentId ||
      batchIntentId ||
      (intent ? stableHash(intent) : null);

    const summaryExecutionPlanId =
      typeof history?.summary?.executionPlanId === "string"
        ? history.summary.executionPlanId
        : null;
    const batchExecutionPlanId =
      typeof history?.batch?.executionPlanId === "string"
        ? history.batch.executionPlanId
        : null;
    executionPlanId = executionPlanId || summaryExecutionPlanId || batchExecutionPlanId || null;
  }

  if (!intentId) {
    throw new Error("BULK_EDIT_INTENT_REQUIRED");
  }
  if (!executionPlanId) {
    const error = new Error("BULK_EDIT_NON_PLAN_BYPASS_BLOCKED");
    error.code = "BULK_EDIT_NON_PLAN_BYPASS_BLOCKED";
    throw error;
  }

  const shopPriority = Number(options.priority ?? data.shopWeight ?? data.priority);
  const payload = {
    historyId: data.historyId,
    shop: data.shop,
    source: data.source || "bulk-edit",
    executionId: data.executionId,
    operationId: data.operationId,
    intentId,
    executionPlanId,
  };

  return getBulkEditQueue().add(
    "bulk-edit-execute",
    payload,
    mergeJobOptions(defaultJobOptions, {
      ...options,
      ...(Number.isFinite(shopPriority) && shopPriority > 0
        ? { priority: Math.floor(shopPriority) }
        : {}),
      jobId:
        options.jobId ||
        buildOperationJobId(OPERATION_QUEUE_NAMES.BULK_EDIT_EXECUTE, {
          shop: data.shop,
          operationId: data.operationId,
        }),
    }),
  );
}

export { getBulkEditQueue };
