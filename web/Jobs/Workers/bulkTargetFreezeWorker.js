import { createWorker } from "./createWorker.js";
import { bulkEditExecuteQueue } from "../Queues/bulkEditExecuteQueue.js";
import { WORKER_CONCURRENCY } from "../workerConcurrency.js";
import { storeOperationRepository } from "../../repositories/storeOperationRepository.js";
import { operationLeaseService } from "../../services/execution/operationLeaseService.js";
import { targetFreezeService } from "../../services/productService/targetFreezeService.js";

export const bulkTargetFreezeWorker = createWorker(
  "bulk.target.freeze",
  async (job) => {
    const { shop, operationId } = job.data;

    const operation = await storeOperationRepository.findById(operationId);

    if (!operation || operation.shop !== shop) {
      throw new Error("OPERATION_NOT_FOUND");
    }

    await operationLeaseService.withLease(
      { operationId, workerId: `freeze-worker:${process.pid}` },
      async () => {
        await targetFreezeService.freezeForOperation({
          shop,
          operationId,
          catalogBatchId: operation.catalogBatchId,
          targetHash: operation.targetHash,
        });
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
