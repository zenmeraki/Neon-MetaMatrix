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
import { shopPipelineGuardService } from "../../services/execution/shopPipelineGuardService.js";
import { applyQueueBackpressure } from "./queueBackpressure.js";
import { prisma } from "../../config/database.js";
import { operationReservationService } from "../../services/execution/operationReservationService.js";

const QUEUE_NAME = process.env.UNDO_QUEUE || OPERATION_QUEUE_NAMES.UNDO_EXECUTE;
if (!String(QUEUE_NAME).toUpperCase().includes("UNDO")) {
  throw new Error(`INVALID_UNDO_QUEUE_NAME:${QUEUE_NAME}`);
}

const defaultJobOptions = buildDefaultJobOptions({
  attempts: 5,
  priority: 7,
  backoffDelay: 60_000,
  removeOnComplete: { age: 48 * 3600, count: 1_000 },
  removeOnFail: { age: 14 * 24 * 3600, count: 5_000 },
});

let bulkUndoQueueInstance = null;

function getBulkUndoQueue() {
  if (!bulkUndoQueueInstance) {
    bulkUndoQueueInstance = applyQueueBackpressure(
      new Queue(QUEUE_NAME, {
        connection,
        defaultJobOptions,
      }),
    );
  }

  return bulkUndoQueueInstance;
}

export const bulkUndoQueue = createLazyQueueProxy(getBulkUndoQueue);

export async function addBulkUndoJob(data, options = {}) {
  if (!data?.shop || !data?.undoRequestId || !data?.undoExecutionPlanId) {
    throw new Error("bulk undo job requires shop, undoRequestId, and undoExecutionPlanId");
  }

  const payload = {
    shop: data.shop,
    undoRequestId: data.undoRequestId,
    undoExecutionPlanId: data.undoExecutionPlanId,
    source: data.source || "undo",
  };

  const plan = await prisma.undoExecutionPlan.findFirst({
    where: {
      id: payload.undoExecutionPlanId,
      shop: payload.shop,
      undoRequestId: payload.undoRequestId,
      status: "CREATED",
    },
    select: {
      id: true,
      planHash: true,
    },
  });

  if (!plan) {
    throw new Error("UNDO_PLAN_NOT_QUEUEABLE");
  }

  payload.planHash = plan.planHash;

  await shopPipelineGuardService.assertCanQueue({
    shop: payload.shop,
    pipeline: "undo",
    operationId: payload.undoExecutionPlanId,
  });

  await operationReservationService.reserve({
    shop: payload.shop,
    pipeline: "undo",
    operationId: payload.undoExecutionPlanId,
    status: "QUEUED",
  });

  const jobId = buildOperationJobId(OPERATION_QUEUE_NAMES.UNDO_EXECUTE, {
    shop: payload.shop,
    undoRequestId: payload.undoRequestId,
    undoExecutionPlanId: payload.undoExecutionPlanId,
  });

  const { jobId: _ignoredJobId, ...safeOptions } = options;

  try {
    return await getBulkUndoQueue().add(
      "bulk-undo",
      payload,
      mergeJobOptions(defaultJobOptions, {
        ...safeOptions,
        jobId,
      }),
    );
  } catch (error) {
    await operationReservationService.release({
      shop: payload.shop,
      pipeline: "undo",
      operationId: payload.undoExecutionPlanId,
    }).catch(() => {});
    throw error;
  }
}

export { getBulkUndoQueue };
