import {
  claimDueScheduledEdits,
  scheduledEditRunRepository,
} from "../repositories/scheduledEditRunRepository.js";
import { storeOperationRepository } from "../repositories/storeOperationRepository.js";
import { prisma } from "../config/database.js";
import {
  BULK_EDIT_EXECUTION_STATES,
  isTerminalExecutionState,
} from "./bulkEditExecutionStateService.js";
import {
  buildBulkEditIdempotencyKey,
  stableHash,
} from "../utils/idempotencyKey.js";

const SCHEDULED_ALLOWED_HISTORY_STATES = new Set([
  BULK_EDIT_EXECUTION_STATES.PLANNED,
  BULK_EDIT_EXECUTION_STATES.QUEUED,
  BULK_EDIT_EXECUTION_STATES.FAILED,
]);
const SCHEDULED_ALLOWED_HISTORY_STATUS = new Set(["pending"]);
const RESUMABLE_OPERATION_STATUSES = new Set([
  "PLANNED",
  "SNAPSHOTTING",
  "SNAPSHOTTED",
  "DISPATCHING",
  "AWAITING_SHOPIFY",
  "APPLYING_RESULTS",
]);
const RETRYABLE_SCHEDULE_CREATE_CODES = new Set([
  "P2002",
  "P2034",
  "SCHEDULED_RUN_ALREADY_PROCESSED",
  "SCHEDULED_RUN_LINK_FAILED",
  "EDIT_HISTORY_LINK_FAILED",
]);

function isRetryableCreateFailure(error) {
  return RETRYABLE_SCHEDULE_CREATE_CODES.has(error?.code);
}

function assertReusableScheduledOperation(operation) {
  if (!operation) return false;
  if (operation.type !== "SCHEDULED_EDIT") return false;
  if (operation.source !== "SCHEDULED") return false;
  if (!RESUMABLE_OPERATION_STATUSES.has(operation.status)) return false;
  return true;
}

function normalizeSummarySnapshot(summary) {
  return summary && typeof summary === "object" && !Array.isArray(summary)
    ? summary
    : {};
}

function normalizeBatchSnapshot(batch) {
  return batch && typeof batch === "object" && !Array.isArray(batch) ? batch : {};
}

function buildScheduledExecutionSnapshotFromLegacyHistory({ run, history }) {
  const summary = normalizeSummarySnapshot(history.summary);
  const batch = normalizeBatchSnapshot(history.batch);
  const immutableIntentId =
    typeof summary.intentId === "string" && summary.intentId.trim()
      ? summary.intentId.trim()
      : null;
  const immutableMutationPlanHash =
    typeof summary.mutationPlanHash === "string" && summary.mutationPlanHash.trim()
      ? summary.mutationPlanHash.trim()
      : null;
  const sourceTargetSnapshotId =
    typeof batch.sourceTargetSnapshotId === "string" && batch.sourceTargetSnapshotId.trim()
      ? batch.sourceTargetSnapshotId.trim()
      : null;

  if (!immutableIntentId || !immutableMutationPlanHash || !sourceTargetSnapshotId) {
    const error = new Error("SCHEDULED_EXECUTION_SNAPSHOT_INCOMPLETE");
    error.code = "SCHEDULED_EXECUTION_SNAPSHOT_INCOMPLETE";
    throw error;
  }

  return {
    schemaVersion: "scheduled_edit_execution_snapshot.v1",
    scheduledRunId: run.id,
    scheduledFor: new Date(run.scheduledFor).toISOString(),
    scheduledEditId: run.scheduledEditId,
    shop: run.shop,
    intentId: immutableIntentId,
    mutationPlanHash: immutableMutationPlanHash,
    sourceTargetSnapshotId,
    targetMirrorBatchId: history.targetMirrorBatchId || null,
    targetSnapshotCount: Number(history.targetSnapshotCount || 0),
    totalItems: Number(history.totalItems || 0),
    executionPlanVersion: 1,
  };
}

export const scheduledEditService = {
  async claimDueRuns({ limit = 50, claimJobId = null } = {}) {
    return claimDueScheduledEdits(limit, prisma, {
      claimedBy: claimJobId ? String(claimJobId) : "scheduled.claim",
    });
  },

  async createOperationForRun({ shop, scheduledRunId, dispatchJobId = null }) {
    const claimOwner = dispatchJobId ? String(dispatchJobId) : null;
    try {
      const operation = await prisma.$transaction(async (tx) => {
        const run = await scheduledEditRunRepository.findById(scheduledRunId, tx);
        if (!run || run.shop !== shop) {
          const error = new Error("SCHEDULED_RUN_NOT_FOUND");
          error.code = "SCHEDULED_RUN_NOT_FOUND";
          throw error;
        }
        if (claimOwner && run.claimedBy && run.claimedBy !== claimOwner) {
          const error = new Error("SCHEDULED_RUN_CLAIM_OWNER_MISMATCH");
          error.code = "SCHEDULED_RUN_CLAIM_OWNER_MISMATCH";
          throw error;
        }

        if (run.operationId) {
          const existingOperation = await tx.merchantOperation.findUnique({
            where: { id: run.operationId },
          });
          if (assertReusableScheduledOperation(existingOperation)) {
            return {
              ...existingOperation,
              scheduledRunId: run.id,
            };
          }
          const error = new Error("SCHEDULED_RUN_OPERATION_NOT_REUSABLE");
          error.code = "SCHEDULED_RUN_OPERATION_NOT_REUSABLE";
          throw error;
        }

        const createClaim = await scheduledEditRunRepository.markCreatingWithOwner(
          scheduledRunId,
          shop,
          claimOwner,
          tx,
        );
        if (createClaim.count !== 1) {
          const error = new Error("SCHEDULED_RUN_ALREADY_PROCESSED");
          error.code = "SCHEDULED_RUN_ALREADY_PROCESSED";
          throw error;
        }

        const history = await tx.editHistory.findFirst({
          where: {
            id: run.scheduledEditId,
            shop,
          },
          select: {
            id: true,
            shop: true,
            status: true,
            executionState: true,
            type: true,
            triggerType: true,
            scheduledTask: true,
            scheduledAt: true,
            scheduledUndoAt: true,
            queryFilter: true,
            rules: true,
            summary: true,
            targetMirrorBatchId: true,
            totalItems: true,
            targetSnapshotCount: true,
            batch: true,
          },
        });
        if (!history) {
          const error = new Error("SCHEDULED_EDIT_HISTORY_NOT_FOUND");
          error.code = "SCHEDULED_EDIT_HISTORY_NOT_FOUND";
          throw error;
        }
        if (isTerminalExecutionState(history.executionState)) {
          const error = new Error("SCHEDULED_EDIT_HISTORY_TERMINAL_STATE");
          error.code = "SCHEDULED_EDIT_HISTORY_TERMINAL_STATE";
          throw error;
        }
        if (!SCHEDULED_ALLOWED_HISTORY_STATES.has(history.executionState)) {
          const error = new Error("SCHEDULED_EDIT_HISTORY_NOT_DISPATCHABLE");
          error.code = "SCHEDULED_EDIT_HISTORY_NOT_DISPATCHABLE";
          throw error;
        }
        if (!SCHEDULED_ALLOWED_HISTORY_STATUS.has(history.status)) {
          const error = new Error("SCHEDULED_EDIT_HISTORY_STATUS_INVALID");
          error.code = "SCHEDULED_EDIT_HISTORY_STATUS_INVALID";
          throw error;
        }
        const isScheduledCompatible =
          history.triggerType === "SCHEDULED_ONCE" ||
          Boolean(history.scheduledTask) ||
          Boolean(history.scheduledAt) ||
          Boolean(history.scheduledUndoAt);
        if (!isScheduledCompatible) {
          const error = new Error("SCHEDULED_EDIT_HISTORY_NOT_SCHEDULED_COMPATIBLE");
          error.code = "SCHEDULED_EDIT_HISTORY_NOT_SCHEDULED_COMPATIBLE";
          throw error;
        }

        const persistedSnapshot = await tx.scheduledEditExecutionSnapshot.findUnique({
          where: { runId: run.id },
          select: {
            sourceTargetSnapshotId: true,
            snapshotFingerprint: true,
            targetMirrorBatchId: true,
            targetSnapshotCount: true,
            totalItems: true,
            intentId: true,
            mutationPlanHash: true,
            executionPlanVersion: true,
          },
        });

        const frozenSnapshot = persistedSnapshot
          ? {
              schemaVersion: "scheduled_edit_execution_snapshot.v1",
              scheduledRunId: run.id,
              scheduledFor: new Date(run.scheduledFor).toISOString(),
              scheduledEditId: run.scheduledEditId,
              shop: run.shop,
              intentId: persistedSnapshot.intentId || null,
              mutationPlanHash: persistedSnapshot.mutationPlanHash || null,
              sourceTargetSnapshotId: persistedSnapshot.sourceTargetSnapshotId,
              targetMirrorBatchId: persistedSnapshot.targetMirrorBatchId || null,
              targetSnapshotCount: Number(persistedSnapshot.targetSnapshotCount || 0),
              totalItems: Number(persistedSnapshot.totalItems || 0),
              executionPlanVersion: Number(persistedSnapshot.executionPlanVersion || 1),
              snapshotFingerprint: persistedSnapshot.snapshotFingerprint,
            }
          : buildScheduledExecutionSnapshotFromLegacyHistory({
              run,
              history,
            });
        const snapshotFingerprint =
          frozenSnapshot.snapshotFingerprint || stableHash(frozenSnapshot);
        const targetHash = stableHash({
          snapshotFingerprint,
          mutationPlanHash: frozenSnapshot.mutationPlanHash,
          sourceTargetSnapshotId: frozenSnapshot.sourceTargetSnapshotId,
          targetMirrorBatchId: frozenSnapshot.targetMirrorBatchId,
          targetSnapshotCount: frozenSnapshot.targetSnapshotCount,
        });
        const clientRequestId = `scheduled-run:${run.id}`;
        const idempotencyKey = buildBulkEditIdempotencyKey({
          shop,
          userId: "system",
          targetHash,
          editPayload: {
            snapshotFingerprint,
            intentId: frozenSnapshot.intentId,
            mutationPlanHash: frozenSnapshot.mutationPlanHash,
          },
          clientRequestId,
        });

        const existing = await tx.merchantOperation.findFirst({
          where: {
            shop,
            idempotencyKey,
            type: "SCHEDULED_EDIT",
            source: "SCHEDULED",
            inputHash: snapshotFingerprint,
          },
        });

        let currentOperation = existing;
        if (!currentOperation) {
          try {
            currentOperation = await tx.merchantOperation.create({
            data: {
              shop,
              type: "SCHEDULED_EDIT",
              status: "PLANNED",
              title: history.type || "Scheduled edit",
              source: "SCHEDULED",
              idempotencyKey,
              targetHash,
              inputHash: snapshotFingerprint,
              totalItems: Number(
                history.targetSnapshotCount || history.totalItems || 0,
              ),
            },
            });
          } catch (createError) {
            if (createError?.code !== "P2002") throw createError;
            currentOperation = await tx.merchantOperation.findFirst({
              where: {
                shop,
                idempotencyKey,
                type: "SCHEDULED_EDIT",
                source: "SCHEDULED",
                inputHash: snapshotFingerprint,
              },
            });
            if (!currentOperation) throw createError;
          }
        }

        const linked = await scheduledEditRunRepository.markStartedIfUnlinked(
          run.id,
          shop,
          currentOperation.id,
          tx,
        );

        if (linked.count !== 1) {
          const error = new Error("SCHEDULED_RUN_LINK_FAILED");
          error.code = "SCHEDULED_RUN_LINK_FAILED";
          throw error;
        }

        const historyUpdated = await tx.editHistory.updateMany({
          where: {
            id: history.id,
            shop,
            OR: [{ operationId: null }, { operationId: currentOperation.id }],
          },
          data: {
            operationId: currentOperation.id,
            batch: {
              ...(history.batch || {}),
              operationId: currentOperation.id,
            },
          },
        });
        if (historyUpdated.count !== 1) {
          const error = new Error("EDIT_HISTORY_LINK_FAILED");
          error.code = "EDIT_HISTORY_LINK_FAILED";
          throw error;
        }

        const persistedRun = await scheduledEditRunRepository.findById(run.id, tx);
        if (!persistedRun?.operationId) {
          const error = new Error("SCHEDULED_RUN_OPERATION_LINK_MISSING");
          error.code = "SCHEDULED_RUN_OPERATION_LINK_MISSING";
          throw error;
        }

        return {
          ...currentOperation,
          scheduledRunId: run.id,
          inputHash: snapshotFingerprint,
        };
      });

      return {
        ...operation,
        dispatchJobId,
        idempotencyKey: operation.idempotencyKey,
      };
    } catch (error) {
      if (isRetryableCreateFailure(error)) {
        await scheduledEditRunRepository.resetCreatingToClaimed(
          scheduledRunId,
          shop,
        );
      } else {
        await scheduledEditRunRepository
          .markFailed(
            scheduledRunId,
            {
              errorCode: error.code || "SCHEDULED_RUN_FATAL_CREATE_ERROR",
              errorMessage: error.message,
            },
          )
          .catch(() => {});
      }
      throw error;
    }
  },
};
