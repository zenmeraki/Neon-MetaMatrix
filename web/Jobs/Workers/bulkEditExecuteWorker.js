import { createWorker } from "./createWorker.js";
import { bulkEditFinalizeQueue } from "../Queues/bulkEditFinalizeQueue.js";
import { WORKER_CONCURRENCY } from "../workerConcurrency.js";
import { storeOperationRepository } from "../../repositories/storeOperationRepository.js";
import { operationLeaseService } from "../../services/execution/operationLeaseService.js";
import { storeExecutionLockService } from "../../services/execution/storeExecutionLockService.js";
import { bulkEditExecutionService } from "../../services/productService/bulkEditExecutionService.js";

export const bulkEditExecuteWorker = createWorker(
  "bulk.edit.execute",
  async (job) => {
    const { shop, operationId } = job.data;

    const operation = await storeOperationRepository.findById(operationId);

    if (!operation || operation.shop !== shop) {
      throw new Error("OPERATION_NOT_FOUND");
    }

    const writeLock = await storeExecutionLockService.acquireWriteLock({
      shop,
      operationId,
    });

    if (!writeLock.acquired) {
      throw new Error("WRITE_LOCK_HELD");
    }

    const lease = await operationLeaseService.acquire({
      operationId,
      workerId: `bulk-edit-worker:${process.pid}`,
      ttlMs: 30_000,
    });

    if (!lease.acquired) {
      await storeExecutionLockService.releaseWriteLock(writeLock);
      throw new Error("LEASE_NOT_ACQUIRED");
    }

    const renewLease = setInterval(() => {
      operationLeaseService
        .renew({
          operationId,
          workerId: lease.workerId,
          ttlMs: 30_000,
        })
        .catch((error) => {
          console.error("Lease renewal failed", {
            operationId,
            error: error.message,
          });
        });
    }, 10_000);

    try {
      await storeOperationRepository.markRunningForLease(
        operationId,
        lease.workerId,
      );

      await bulkEditExecutionService.execute({
        shop,
        operationId,
        workerId: lease.workerId,
      });

      await bulkEditFinalizeQueue.add(
        "bulk.edit.finalize",
        { shop, operationId },
        {
          jobId: `bulk:finalize:${shop}:${operationId}`,
          priority: 2,
        },
      );
    } catch (error) {
      await storeOperationRepository.failForLease(operationId, lease.workerId, {
        errorCode: error.code || "BULK_EDIT_EXECUTE_FAILED",
        errorMessage: error.message,
      });

      throw error;
    } finally {
      clearInterval(renewLease);
      await operationLeaseService.release({
        operationId,
        workerId: lease.workerId,
      });
      await storeExecutionLockService.releaseWriteLock(writeLock);
    }
  },
  {
    concurrency: WORKER_CONCURRENCY.BULK_EDIT_EXECUTE,
  },
);
