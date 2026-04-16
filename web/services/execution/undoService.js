import crypto from "crypto";
import {
  BULK_UNDO_STATES,
  buildExecutionError,
  buildPlannedUndoState,
  isTerminalUndoState,
  normalizeUndoState,
} from "../bulkEditExecutionStateService.js";
import * as bulkMutationExecutionService from "./bulkMutationExecutionService.js";
import * as undoOutcomeRepository from "../../repositories/undoOutcomeRepository.js";
import * as undoPlanRepository from "../../repositories/undoPlanRepository.js";

/**
 * Undo execution service.
 *
 * Responsibilities:
 * - plan/queue undo state on EditHistory.undo
 * - create bulk mutation submission audit rows for undo
 * - record undo target outcomes
 *
 * Not responsible for:
 * - Shopify mutation execution
 * - queue dispatching
 * - controller response shaping
 */

const UNDO_MUTATION_TYPE = "UNDO_PRODUCT_EDIT";

const assertShop = (shop) => {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required");
  }
};

const assertHistoryId = (historyId) => {
  if (!historyId || typeof historyId !== "string") {
    throw new Error("historyId is required");
  }
};

const buildConflictError = (message, details = null) => {
  const error = new Error(message);
  error.code = "UNDO_CONFLICT";
  error.httpStatus = 409;
  error.details = details;
  return error;
};

const buildNotFoundError = (message, details = null) => {
  const error = new Error(message);
  error.code = "UNDO_PLAN_NOT_FOUND";
  error.httpStatus = 404;
  error.details = details;
  return error;
};

const getUndoOrPlanned = (record) => {
  return normalizeUndoState(
    record?.undo,
    buildPlannedUndoState({ allowed: false }),
  );
};

const assertUndoCanBeQueued = ({ record, undo }) => {
  if (!record) {
    throw buildNotFoundError("Edit history not found");
  }

  if (record.status !== "completed") {
    throw buildConflictError("Undo can only be queued for completed edits", {
      status: record.status,
    });
  }

  if (undo.allowed === false) {
    throw buildConflictError("Undo is not allowed for this edit");
  }

  if (
    [
      BULK_UNDO_STATES.QUEUED,
      BULK_UNDO_STATES.DISPATCHING,
      BULK_UNDO_STATES.AWAITING_SHOPIFY,
      BULK_UNDO_STATES.FINALIZING,
      BULK_UNDO_STATES.COMPLETED,
    ].includes(undo.state)
  ) {
    throw buildConflictError("Undo is already queued or completed", {
      state: undo.state,
    });
  }
};

export const getUndoPlan = async ({ shop, historyId }) => {
  assertShop(shop);
  assertHistoryId(historyId);

  const record = await undoPlanRepository.findUndoPlanByHistoryId({
    shop,
    historyId,
  });

  if (!record) {
    throw buildNotFoundError("Edit history not found", { historyId });
  }

  return {
    history: record,
    undo: getUndoOrPlanned(record),
  };
};

export const queueUndoPlan = async ({
  shop,
  historyId,
  executionIdentity = null,
  source = "manual_undo",
}) => {
  assertShop(shop);
  assertHistoryId(historyId);

  const record = await undoPlanRepository.findUndoPlanByHistoryId({
    shop,
    historyId,
  });
  const undo = getUndoOrPlanned(record);

  assertUndoCanBeQueued({ record, undo });

  const resolvedExecutionIdentity =
    executionIdentity || undo.executionIdentity || crypto.randomUUID();

  const updated = await undoPlanRepository.updateUndoPlan({
    shop,
    historyId,
    patch: {
      ...undo,
      status: "pending",
      state: BULK_UNDO_STATES.QUEUED,
      queuedAt: new Date(),
      startedAt: null,
      completedAt: null,
      processedCount: 0,
      durationMs: 0,
      bulkOperationId: null,
      executionIdentity: resolvedExecutionIdentity,
      source,
      error: null,
    },
  });

  return {
    history: updated,
    undo: getUndoOrPlanned(updated),
  };
};

export const markUndoDispatching = async ({ shop, historyId }) => {
  const { undo } = await getUndoPlan({ shop, historyId });

  if (isTerminalUndoState(undo.state)) {
    return { undo };
  }

  const updated = await undoPlanRepository.updateUndoPlan({
    shop,
    historyId,
    patch: {
      ...undo,
      status: "processing",
      state: BULK_UNDO_STATES.DISPATCHING,
      startedAt: undo.startedAt || new Date(),
      error: null,
    },
  });

  return {
    history: updated,
    undo: getUndoOrPlanned(updated),
  };
};

export const markUndoAwaitingShopify = async ({
  shop,
  historyId,
  bulkOperationId,
  bulkMutationSubmissionId = null,
}) => {
  assertShop(shop);
  assertHistoryId(historyId);

  if (!bulkOperationId) {
    throw new Error("bulkOperationId is required");
  }

  const { undo } = await getUndoPlan({ shop, historyId });

  const submission =
    bulkMutationSubmissionId ||
    (await bulkMutationExecutionService.createBulkMutationSubmission({
      shop,
      mutationType: UNDO_MUTATION_TYPE,
      editHistoryId: historyId,
      bulkOperationId,
      status: "SUBMITTED",
    }));

  const resolvedSubmissionId =
    typeof submission === "string" ? submission : submission.id;

  const updated = await undoPlanRepository.updateUndoPlan({
    shop,
    historyId,
    patch: {
      ...undo,
      status: "processing",
      state: BULK_UNDO_STATES.AWAITING_SHOPIFY,
      bulkOperationId,
      bulkMutationSubmissionId: resolvedSubmissionId,
      startedAt: undo.startedAt || new Date(),
    },
  });

  return {
    history: updated,
    undo: getUndoOrPlanned(updated),
    bulkMutationSubmissionId: resolvedSubmissionId,
  };
};

export const markUndoFinalizing = async ({ shop, historyId }) => {
  const { undo } = await getUndoPlan({ shop, historyId });

  const updated = await undoPlanRepository.updateUndoPlan({
    shop,
    historyId,
    patch: {
      ...undo,
      status: "processing",
      state: BULK_UNDO_STATES.FINALIZING,
    },
  });

  return {
    history: updated,
    undo: getUndoOrPlanned(updated),
  };
};

export const recordUndoOutcomes = async ({
  shop,
  historyId,
  bulkMutationSubmissionId,
  outcomes,
}) => {
  assertShop(shop);
  assertHistoryId(historyId);

  if (!bulkMutationSubmissionId) {
    throw new Error("bulkMutationSubmissionId is required");
  }

  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    throw new Error("outcomes must be a non-empty array");
  }

  const rows = outcomes.map((outcome) => ({
    bulkMutationSubmissionId,
    shop,
    targetId: outcome.targetId || null,
    productId: outcome.productId || null,
    variantId: outcome.variantId || null,
    status: outcome.status || "UNKNOWN",
    code: outcome.code || null,
    message: outcome.message || null,
    raw: {
      historyId,
      ...(outcome.raw && typeof outcome.raw === "object" ? outcome.raw : {}),
    },
  }));

  return undoOutcomeRepository.createManyUndoOutcomes(rows);
};

export const markUndoCompleted = async ({
  shop,
  historyId,
  processedCount = null,
  durationMs = null,
}) => {
  const { undo } = await getUndoPlan({ shop, historyId });
  const completedAt = new Date();

  const updated = await undoPlanRepository.updateUndoPlan({
    shop,
    historyId,
    patch: {
      ...undo,
      status: "completed",
      state: BULK_UNDO_STATES.COMPLETED,
      completedAt,
      ...(typeof processedCount === "number" ? { processedCount } : {}),
      ...(typeof durationMs === "number" ? { durationMs } : {}),
      error: null,
    },
  });

  if (undo.bulkMutationSubmissionId) {
    await bulkMutationExecutionService.markBulkMutationCompleted({
      bulkMutationSubmissionId: undo.bulkMutationSubmissionId,
      rowCount: processedCount,
    }).catch(() => {});
  }

  return {
    history: updated,
    undo: getUndoOrPlanned(updated),
  };
};

export const markUndoFailed = async ({
  shop,
  historyId,
  failureCode = "UNDO_FAILED",
  failureMessage = "Undo failed",
  details = null,
}) => {
  const { undo } = await getUndoPlan({ shop, historyId });
  const error = buildExecutionError({
    code: failureCode,
    stage: undo.state || BULK_UNDO_STATES.FAILED,
    message: failureMessage,
    details,
  });

  const updated = await undoPlanRepository.updateUndoPlan({
    shop,
    historyId,
    patch: {
      ...undo,
      status: "failed",
      state: BULK_UNDO_STATES.FAILED,
      completedAt: new Date(),
      error,
    },
  });

  if (undo.bulkMutationSubmissionId) {
    await bulkMutationExecutionService.markBulkMutationFailed({
      bulkMutationSubmissionId: undo.bulkMutationSubmissionId,
      failureCode,
      failureMessage,
      failureCategory: "INTERNAL",
      failureStage: undo.state || BULK_UNDO_STATES.FAILED,
      retryable: false,
    }).catch(() => {});
  }

  return {
    history: updated,
    undo: getUndoOrPlanned(updated),
  };
};

export const getUndoAuditContext = async ({ shop, historyId }) => {
  const { history, undo } = await getUndoPlan({ shop, historyId });
  const bulkMutationSubmissionId = undo.bulkMutationSubmissionId || null;
  const outcomeSummary = bulkMutationSubmissionId
    ? await undoOutcomeRepository.summarizeUndoOutcomesBySubmissionId(
        bulkMutationSubmissionId,
      )
    : {};

  return {
    history,
    undo,
    bulkMutationSubmissionId,
    outcomeSummary,
  };
};
