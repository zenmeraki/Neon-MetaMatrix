import { createWorker } from "./createWorker.js";
import { bulkEditFinalizeQueue } from "../queues/bulkEditFinalizeQueue.js";
import { WORKER_CONCURRENCY } from "../workerConcurrency.js";
import { prisma } from "../../config/database.js";
import { operationLeaseService } from "../../services/execution/operationLeaseService.js";
import { storeExecutionLockService } from "../../services/execution/storeExecutionLockService.js";
import { bulkEditExecutionService } from "../../services/productService/bulkEditExecutionService.js";
import { transitionOperation } from "../../services/operationTransitionService.js";
import { operationService } from "../../services/operationService.js";
import { requireJobData } from "../../utils/jobPayloadValidation.js";
import logger from "../../utils/loggerUtils.js";
import { assertRollbackArtifactsReady } from "../../services/execution/rollbackArtifactService.js";
import { assertPreparedMutationArtifactReady } from "../../services/execution/preparedMutationArtifactService.js";
import { operationEventRepository } from "../../repositories/operationEventRepository.js";

const WORKER_NAME = "bulkEditExecuteWorker";
const LEASE_TTL_MS = 30_000;
const LEASE_RENEW_MS = 10_000;

function retryableError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  error.retryable = true;
  return error;
}

function isRetryable(error) {
  return Boolean(error?.retryable);
}

export const bulkEditExecuteWorker = createWorker(
  "bulk.edit.execute",
  async (job) => {
    const { shop, operationId } = requireJobData(
      job,
      ["shop", "operationId"],
      "bulk edit execute",
    );

    let writeLock = null;
    let lease = null;
    let leaseRenewal = null;
    let leaseLost = false;
    let currentLockVersion = null;

    try {
      writeLock = await storeExecutionLockService.acquireWriteLock({
        shop,
        operationId,
      });

      if (!writeLock.acquired) {
        throw retryableError("WRITE_LOCK_HELD");
      }

      lease = await operationLeaseService.acquire({
        operationId,
        workerId: `${WORKER_NAME}:${process.pid}`,
        ttlMs: LEASE_TTL_MS,
      });

      if (!lease.acquired) {
        throw retryableError("LEASE_NOT_ACQUIRED");
      }
      currentLockVersion = lease.lockVersion || null;

      leaseRenewal = setInterval(() => {
        operationLeaseService
          .renew({
            operationId,
            workerId: lease.workerId,
            ttlMs: LEASE_TTL_MS,
          })
          .then(async (result) => {
            if (!result?.renewed) {
              leaseLost = true;
              return;
            }
            currentLockVersion = result.lockVersion || currentLockVersion;

            await operationService
              .checkpointExecution({
                shop,
                operationId,
                workerId: lease.workerId,
                heartbeatAt: new Date(),
                expectedLockVersion: currentLockVersion,
              })
              .catch(() => {});
          })
          .catch((error) => {
            leaseLost = true;
            logger.error("Bulk edit execute lease renewal failed", {
              worker: WORKER_NAME,
              jobId: job?.id,
              shop,
              operationId,
              message: error.message,
            });
          });
      }, LEASE_RENEW_MS);

      leaseRenewal.unref?.();

      const operation = await prisma.merchantOperation.findFirst({
        where: { id: operationId, shop },
        select: { id: true, status: true },
      });

      if (!operation) {
        throw new Error("OPERATION_NOT_FOUND");
      }

      if (["COMPLETED", "FAILED", "CANCELLED"].includes(operation.status)) {
        return {
          skipped: true,
          reason: "operation_terminal",
          shop,
          operationId,
          status: operation.status,
        };
      }

      if (!["SNAPSHOTTED", "DISPATCHING"].includes(operation.status)) {
        throw new Error(`INVALID_EXECUTE_OPERATION_STATE:${operation.status}`);
      }

      const executionPlan = await prisma.executionPlan.findFirst({
        where: { shop, operationId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          planJson: true,
        },
      });

      // Legacy operations may not have execution plans yet; only enforce when plan exists.
      if (executionPlan?.id) {
        try {
          await assertRollbackArtifactsReady({
            shop,
            operationId,
            planJson: executionPlan.planJson,
          });
          await assertPreparedMutationArtifactReady({
            artifact: executionPlan.planJson?.preparedMutationArtifact,
          });
        } catch (error) {
          await operationEventRepository.emit({
            shop,
            operationId,
            type:
              error?.code === "PREPARED_MUTATION_ARTIFACT_REQUIRED" ||
              error?.code === "PREPARED_MUTATION_ARTIFACT_MISSING" ||
              error?.code === "PREPARED_MUTATION_ARTIFACT_CHECKSUM_MISMATCH" ||
              error?.code === "PREPARED_MUTATION_ARTIFACT_PARTIAL"
                ? "PREPARED_MUTATION_ARTIFACT_INVALID"
                : "ROLLBACK_ARTIFACT_MISSING",
            payload: {
              executionPlanId: executionPlan.id,
              code: error?.code || "EXECUTION_ARTIFACT_MISSING",
              message: error?.message || "Execution artifact missing",
              details: error?.details || null,
            },
          }).catch(() => {});
          throw error;
        }
      }

      if (operation.status === "SNAPSHOTTED") {
        await transitionOperation({
          shop,
          operationId,
          from: "SNAPSHOTTED",
          to: "DISPATCHING",
        });
      }

      if (leaseLost) {
        throw retryableError("LEASE_RENEWAL_FAILED");
      }

      await operationLeaseService.assertActive({
        operationId,
        workerId: lease.workerId,
        expectedLockVersion: currentLockVersion,
      });

      const checkpoint = await operationService
        .checkpointExecution({
          shop,
          operationId,
          workerId: lease.workerId,
          heartbeatAt: new Date(),
          expectedLockVersion: currentLockVersion,
        })
        .catch(() => ({ updated: false }));
      if (!checkpoint?.updated) {
        throw retryableError("OPERATION_LEASE_FENCE_MISMATCH");
      }

      const executeResult = await bulkEditExecutionService.execute({
        shop,
        operationId,
        workerId: lease.workerId,
        expectedLockVersion: currentLockVersion,
      });

      if (leaseLost) {
        throw retryableError("LEASE_LOST_AFTER_EXECUTE");
      }

      await operationLeaseService.assertActive({
        operationId,
        workerId: lease.workerId,
        expectedLockVersion: currentLockVersion,
      });

      if (["DISPATCHING", "AWAITING_SHOPIFY"].includes(executeResult?.status)) {
        return {
          success: true,
          shop,
          operationId,
          status: executeResult.status,
          bulkOperationId: executeResult?.bulkOperationId || null,
        };
      }

      if (executeResult?.readyForFinalize === true) {
        const finalizeJobId = `bulk:finalize:${shop}:${operationId}`;

        await bulkEditFinalizeQueue.add(
          "bulk.edit.finalize",
          { shop, operationId },
          {
            jobId: finalizeJobId,
            priority: 2,
          },
        );

        return {
          success: true,
          shop,
          operationId,
          finalizeJobId,
        };
      }

      throw new Error("EXECUTE_RESULT_STATE_UNKNOWN");
    } catch (error) {
      if (!isRetryable(error)) {
        const current = await prisma.merchantOperation.findFirst({
          where: { id: operationId, shop },
          select: { status: true },
        });

        if (
          current &&
          !["FAILED", "CANCELLED", "COMPLETED"].includes(current.status)
        ) {
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
      }

      throw error;
    } finally {
      if (leaseRenewal) clearInterval(leaseRenewal);

      if (lease?.workerId) {
        await operationLeaseService
          .release({
            operationId,
            workerId: lease.workerId,
            expectedLockVersion: currentLockVersion,
          })
          .catch(() => {});
      }

      if (writeLock) {
        await storeExecutionLockService.releaseWriteLock(writeLock).catch(() => {});
      }
    }
  },
  {
    concurrency: WORKER_CONCURRENCY.BULK_EDIT_EXECUTE,
  },
);
