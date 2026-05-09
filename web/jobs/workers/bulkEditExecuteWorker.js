import { createWorker } from "./createWorker.js";
import { bulkEditFinalizeQueue } from "../queues/bulkEditFinalizeQueue.js";
import { WORKER_CONCURRENCY } from "../workerConcurrency.js";
import { prisma } from "../../config/database.js";
import { operationLeaseService } from "../../services/execution/operationLeaseService.js";
import { storeExecutionLockService } from "../../services/execution/storeExecutionLockService.js";
import { bulkEditExecutionService } from "../../services/productService/bulkEditExecutionService.js";
import { transitionOperation } from "../../services/operationTransitionService.js";

export const bulkEditExecuteWorker = createWorker(
  "bulk.edit.execute",
  async (job) => {
    const { shop, operationId } = job.data;

    const operation = await prisma.merchantOperation.findFirst({
      where: { id: operationId, shop },
      select: { id: true, status: true },
    });

    if (!operation) {
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
          renewLease.__leaseLost = true;
        });
    }, 10_000);

    try {
      if (operation.status === "SNAPSHOTTED") {
        await transitionOperation({
          shop,
          operationId,
          from: "SNAPSHOTTED",
          to: "DISPATCHING",
        });
      }

      if (renewLease.__leaseLost) {
        const leaseError = new Error("LEASE_RENEWAL_FAILED");
        leaseError.code = "LEASE_RENEWAL_FAILED";
        throw leaseError;
      }

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
      const current = await prisma.merchantOperation.findFirst({
        where: { id: operationId, shop },
        select: { status: true },
      });
      if (current && current.status !== "FAILED" && current.status !== "CANCELLED") {
        await transitionOperation({
          shop,
          operationId,
          from: current.status,
          to: "FAILED",
          data: {
            failedAt: new Date(),
            errorCode: error.code || "BULK_EDIT_EXECUTE_FAILED",
            errorMessage: error.message,
          },
        });
      }

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
