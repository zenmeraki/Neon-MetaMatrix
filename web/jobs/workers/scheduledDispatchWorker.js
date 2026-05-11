import { bulkTargetFreezeQueue } from "../queues/bulkTargetFreezeQueue.js";
import { createWorker } from "./createWorker.js";
import { WORKER_CONCURRENCY } from "../workerConcurrency.js";
import { scheduledEditService } from "../../services/scheduledEditService.js";
import { requireJobData } from "../../utils/jobPayloadValidation.js";
import logger from "../../utils/loggerUtils.js";

export const scheduledDispatchWorker = createWorker(
  "scheduled.dispatch",
  async (job) => {
    const { shop, scheduledRunId } = requireJobData(
      job,
      ["shop", "scheduledRunId"],
      "scheduled dispatch",
    );

    let operation;

    try {
      operation = await scheduledEditService.createOperationForRun({
        shop,
        scheduledRunId,
        dispatchJobId: job?.id || null,
      });
    } catch (error) {
      if (error?.code === "SCHEDULED_RUN_ALREADY_PROCESSED") {
        return {
          skipped: true,
          reason: error.code,
          shop,
          scheduledRunId,
        };
      }
      throw error;
    }

    if (!operation?.id) {
      throw new Error("SCHEDULED_DISPATCH_OPERATION_ID_REQUIRED");
    }

    const freezeJobId = `bulk:freeze:${shop}:${operation.id}`;

    await bulkTargetFreezeQueue.add(
      "bulk.target.freeze",
      {
        shop,
        operationId: operation.id,
        scheduledRunId,
      },
      {
        jobId: freezeJobId,
        priority: 4,
      },
    );

    logger.info("Scheduled dispatch enqueued target freeze", {
      worker: "scheduledDispatchWorker",
      jobId: job?.id,
      shop,
      scheduledRunId,
      operationId: operation.id,
      freezeJobId,
    });

    return {
      accepted: true,
      shop,
      scheduledRunId,
      operationId: operation.id,
      freezeJobId,
    };
  },
  {
    concurrency: WORKER_CONCURRENCY.SCHEDULED_DISPATCH,
  },
);
