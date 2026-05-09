import { bulkTargetFreezeQueue } from "../queues/bulkTargetFreezeQueue.js";
import { createWorker } from "./createWorker.js";
import { WORKER_CONCURRENCY } from "../workerConcurrency.js";
import { scheduledEditService } from "../../services/scheduledEditService.js";

export const scheduledDispatchWorker = createWorker(
  "scheduled.dispatch",
  async (job) => {
    const { shop, scheduledRunId } = job.data;
    let operation;
    try {
      operation = await scheduledEditService.createOperationForRun({
        shop,
        scheduledRunId,
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

    await bulkTargetFreezeQueue.add(
      "bulk.target.freeze",
      {
        shop,
        operationId: operation.id,
      },
      {
        jobId: `bulk:freeze:${shop}:${operation.id}`,
        priority: 4,
      },
    );
  },
  {
    concurrency: WORKER_CONCURRENCY.SCHEDULED_DISPATCH,
  },
);
