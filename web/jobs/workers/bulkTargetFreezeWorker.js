import { createWorker } from "./createWorker.js";
import { bulkEditExecuteQueue } from "../queues/bulkEditExecuteQueue.js";
import { WORKER_CONCURRENCY } from "../workerConcurrency.js";
import { prisma } from "../../config/database.js";
import { operationLeaseService } from "../../services/execution/operationLeaseService.js";
import { targetFreezeService } from "../../services/productService/targetFreezeService.js";

export const bulkTargetFreezeWorker = createWorker(
  "bulk.target.freeze",
  async (job) => {
    const { shop, operationId } = job.data;

    const operation = await prisma.merchantOperation.findFirst({
      where: { id: operationId, shop },
      select: { id: true, shop: true, targetHash: true },
    });

    if (!operation) {
      throw new Error("OPERATION_NOT_FOUND");
    }

    await operationLeaseService.withLease(
      { operationId, workerId: `freeze-worker:${process.pid}` },
      async () => {
        await targetFreezeService.freezeForOperation({
          shop,
          operationId,
          targetHash: operation.targetHash,
        });

        if (
          String(process.env.CHAOS_CRASH_MID_FREEZE || "").toLowerCase() === "true" &&
          String(process.env.CHAOS_OPERATION_ID || "") === String(operationId)
        ) {
          const error = new Error("CHAOS_CRASH_MID_FREEZE");
          error.code = "CHAOS_CRASH_MID_FREEZE";
          throw error;
        }
      },
    );

    await bulkEditExecuteQueue.add(
      "bulk.edit.execute",
      { shop, operationId },
      {
        jobId: `bulk:execute:${shop}:${operationId}`,
        priority: 3,
      },
    );
  },
  {
    concurrency: WORKER_CONCURRENCY.BULK_TARGET_FREEZE,
  },
);
