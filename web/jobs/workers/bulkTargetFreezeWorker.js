import { createWorker } from "./createWorker.js";
import { bulkEditExecuteQueue } from "../queues/bulkEditExecuteQueue.js";
import { WORKER_CONCURRENCY } from "../workerConcurrency.js";
import { prisma } from "../../config/database.js";
import { operationLeaseService } from "../../services/execution/operationLeaseService.js";
import { targetFreezeService } from "../../services/productService/targetFreezeService.js";
import { transitionOperation } from "../../services/operationTransitionService.js";
import { requireJobData } from "../../utils/jobPayloadValidation.js";
import logger from "../../utils/loggerUtils.js";

export const bulkTargetFreezeWorker = createWorker(
  "bulk.target.freeze",
  async (job) => {
    const { shop, operationId } = requireJobData(
      job,
      ["shop", "operationId"],
      "bulk target freeze",
    );
    let shouldEnqueueExecute = false;

    await operationLeaseService.withLease(
      { operationId, workerId: `freeze-worker:${process.pid}` },
      async () => {
        const operation = await prisma.merchantOperation.findFirst({
          where: { id: operationId, shop },
          select: { id: true, shop: true, status: true, targetHash: true },
        });

        if (!operation) {
          throw new Error("OPERATION_NOT_FOUND");
        }

        if (operation.status === "COMPLETED" || operation.status === "FAILED") {
          return;
        }

        if (!["PLANNED", "SNAPSHOTTING", "SNAPSHOTTED"].includes(operation.status)) {
          throw new Error(`INVALID_FREEZE_OPERATION_STATE:${operation.status}`);
        }

        if (operation.status === "PLANNED") {
          await transitionOperation({
            shop,
            operationId,
            from: "PLANNED",
            to: "SNAPSHOTTING",
            data: {
              startedAt: new Date(),
            },
          });
        }

        const freezeResult = await targetFreezeService.freezeForOperation({
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

        const current = await prisma.merchantOperation.findFirst({
          where: { id: operationId, shop },
          select: { status: true },
        });

        if (current?.status === "SNAPSHOTTING") {
          await transitionOperation({
            shop,
            operationId,
            from: "SNAPSHOTTING",
            to: "SNAPSHOTTED",
            data: {
              totalItems: Number(freezeResult?.targetCount || 0),
              targetHash: freezeResult?.targetHash || operation.targetHash || null,
            },
          });
        }

        const afterFreeze = await prisma.merchantOperation.findFirst({
          where: { id: operationId, shop },
          select: { status: true, totalItems: true },
        });

        if (afterFreeze?.status !== "SNAPSHOTTED") {
          throw new Error(
            `FREEZE_DID_NOT_REACH_SNAPSHOTTED:${afterFreeze?.status || "missing"}`,
          );
        }

        shouldEnqueueExecute = true;
      },
    );

    if (!shouldEnqueueExecute) {
      return {
        skipped: true,
        reason: "operation_terminal_or_not_snapshotted",
        shop,
        operationId,
      };
    }

    const executeJobId = `bulk:execute:${shop}:${operationId}`;

    await bulkEditExecuteQueue.add(
      "bulk.edit.execute",
      { shop, operationId },
      {
        jobId: executeJobId,
        priority: 3,
      },
    );

    logger.info("Bulk target freeze completed and execute job enqueued", {
      worker: "bulkTargetFreezeWorker",
      jobId: job?.id,
      shop,
      operationId,
      executeJobId,
    });

    return {
      success: true,
      shop,
      operationId,
      executeJobId,
    };
  },
  {
    concurrency: WORKER_CONCURRENCY.BULK_TARGET_FREEZE,
  },
);
