import * as bulkMutationOutcomeRepository from "../../repositories/bulkMutationOutcomeRepository.js";
import * as bulkMutationSubmissionRepository from "../../repositories/bulkMutationSubmissionRepository.js";
import { prisma } from "../../Config/database.js";
import logger from "../../utils/loggerUtils.js";

/**
 * Bulk mutation execution service.
 *
 * Responsibilities:
 * - record mutation submissions
 * - update execution lifecycle status
 * - persist per-target outcomes
 *
 * Not responsible for:
 * - Shopify client calls
 * - mutation query construction
 * - target compilation
 */

export const SUBMISSION_STATUS = {
  PLANNED: "PLANNED",
  SUBMITTED: "SUBMITTED",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
};

export const OUTCOME_STATUS = {
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  SKIPPED: "SKIPPED",
};

export const VALID_TRANSITIONS = {
  [SUBMISSION_STATUS.PLANNED]: [
    SUBMISSION_STATUS.SUBMITTED,
    SUBMISSION_STATUS.CANCELLED,
  ],
  [SUBMISSION_STATUS.SUBMITTED]: [
    SUBMISSION_STATUS.RUNNING,
    SUBMISSION_STATUS.FAILED,
  ],
  [SUBMISSION_STATUS.RUNNING]: [
    SUBMISSION_STATUS.COMPLETED,
    SUBMISSION_STATUS.FAILED,
  ],
  [SUBMISSION_STATUS.COMPLETED]: [],
  [SUBMISSION_STATUS.FAILED]: [],
  [SUBMISSION_STATUS.CANCELLED]: [],
};

export class BulkMutationSubmissionNotFoundError extends Error {
  constructor({ bulkOperationId, shop }) {
    super(
      `Bulk mutation submission not found for shop ${shop} and operation ${bulkOperationId}`,
    );
    this.name = "BulkMutationSubmissionNotFoundError";
    this.bulkOperationId = bulkOperationId;
    this.shop = shop;
  }
}

export class InvalidBulkMutationStatusTransitionError extends Error {
  constructor({ bulkMutationSubmissionId, currentStatus, nextStatus }) {
    super(
      `Invalid bulk mutation transition ${currentStatus} -> ${nextStatus} for submission ${bulkMutationSubmissionId}`,
    );
    this.name = "InvalidBulkMutationStatusTransitionError";
    this.bulkMutationSubmissionId = bulkMutationSubmissionId;
    this.currentStatus = currentStatus;
    this.nextStatus = nextStatus;
  }
}

const assertShop = (shop) => {
  if (!shop || typeof shop !== "string" || shop.trim() === "") {
    throw new Error("shop is required");
  }
  if (shop !== shop.trim() || !/^[a-z0-9][a-z0-9.-]*$/i.test(shop)) {
    throw new Error("shop format is invalid");
  }
};

const assertSubmissionId = (bulkMutationSubmissionId) => {
  if (
    !bulkMutationSubmissionId ||
    typeof bulkMutationSubmissionId !== "string" ||
    bulkMutationSubmissionId.trim() === ""
  ) {
    throw new Error("bulkMutationSubmissionId is required");
  }
};

const assertValidRowCount = (rowCount) => {
  if (
    rowCount !== null &&
    rowCount !== undefined &&
    (!Number.isInteger(rowCount) || rowCount < 0)
  ) {
    throw new Error("rowCount must be a non-negative integer");
  }
};

const assertValidTransition = ({
  bulkMutationSubmissionId,
  currentStatus,
  nextStatus,
}) => {
  if (currentStatus === nextStatus) {
    return;
  }

  if (!VALID_TRANSITIONS[currentStatus]?.includes(nextStatus)) {
    throw new InvalidBulkMutationStatusTransitionError({
      bulkMutationSubmissionId,
      currentStatus,
      nextStatus,
    });
  }
};

const transitionBulkMutationSubmission = async ({
  bulkMutationSubmissionId,
  nextStatus,
  data = {},
  tx = null,
}) => {
  assertSubmissionId(bulkMutationSubmissionId);

  const submission =
    await bulkMutationSubmissionRepository.findBulkMutationSubmissionById(
      bulkMutationSubmissionId,
      { tx },
    );

  if (!submission?.id) {
    throw new Error(
      `Bulk mutation submission ${bulkMutationSubmissionId} was not found`,
    );
  }

  if (submission.status === nextStatus) {
    return submission;
  }

  assertValidTransition({
    bulkMutationSubmissionId,
    currentStatus: submission.status,
    nextStatus,
  });

  const writeResult =
    await bulkMutationSubmissionRepository.compareAndSetBulkMutationSubmissionStatus(
      {
        id: bulkMutationSubmissionId,
        currentStatus: submission.status,
        data: {
          ...data,
          status: nextStatus,
        },
      },
      { tx },
    );

  if (writeResult.count !== 1) {
    throw new Error(
      `Concurrent status transition detected for bulk mutation submission ${bulkMutationSubmissionId}`,
    );
  }

  return bulkMutationSubmissionRepository.findBulkMutationSubmissionById(
    bulkMutationSubmissionId,
    { tx },
  );
};

export const createBulkMutationSubmission = async ({
  shop,
  mutationType,
  syncRunId = null,
  editHistoryId = null,
  targetSnapshotSetId = null,
  bulkOperationId = null,
  batchId = null,
  inputArtifactSha256 = null,
  inputRowHash = null,
  status = SUBMISSION_STATUS.PLANNED,
}) => {
  assertShop(shop);

  if (!mutationType) {
    throw new Error("mutationType is required");
  }

  if (!Object.values(SUBMISSION_STATUS).includes(status)) {
    throw new Error(`Invalid bulk mutation submission status ${status}`);
  }

  if (inputRowHash) {
    const existing =
      await bulkMutationSubmissionRepository.findBulkMutationSubmissionByInputRowHash({
        shop,
        mutationType,
        inputRowHash,
      });

    if (existing?.id) {
      return existing;
    }
  }

  try {
    return await bulkMutationSubmissionRepository.createBulkMutationSubmission({
      shop,
      mutationType,
      syncRunId,
      editHistoryId,
      targetSnapshotSetId,
      bulkOperationId,
      batchId,
      inputArtifactSha256,
      inputRowHash,
      status,
    });
  } catch (err) {
    if (inputRowHash && err?.code === "P2002") {
      const existing =
        await bulkMutationSubmissionRepository.findBulkMutationSubmissionByInputRowHash({
          shop,
          mutationType,
          inputRowHash,
        });
      if (existing?.id) return existing;
    }
    throw err;
  }
};

export const markBulkMutationSubmitted = async ({
  bulkMutationSubmissionId,
  bulkOperationId,
}) => {
  assertSubmissionId(bulkMutationSubmissionId);

  if (!bulkOperationId) {
    throw new Error("bulkOperationId is required");
  }

  return transitionBulkMutationSubmission({
    bulkMutationSubmissionId,
    nextStatus: SUBMISSION_STATUS.SUBMITTED,
    data: {
      bulkOperationId,
      submittedAt: new Date(),
    },
  });
};

export const markBulkMutationRunning = async (bulkMutationSubmissionId) => {
  return transitionBulkMutationSubmission({
    bulkMutationSubmissionId,
    nextStatus: SUBMISSION_STATUS.RUNNING,
  });
};

export const markBulkMutationCompleted = async ({
  bulkMutationSubmissionId,
  rowCount = null,
}) => {
  assertSubmissionId(bulkMutationSubmissionId);
  assertValidRowCount(rowCount);

  const submission =
    await bulkMutationSubmissionRepository.findBulkMutationSubmissionById(
      bulkMutationSubmissionId,
    );

  if (submission?.status === SUBMISSION_STATUS.COMPLETED) {
    return submission;
  }

  if (submission?.status === SUBMISSION_STATUS.SUBMITTED) {
    await markBulkMutationRunning(bulkMutationSubmissionId);
  }

  return transitionBulkMutationSubmission({
    bulkMutationSubmissionId,
    nextStatus: SUBMISSION_STATUS.COMPLETED,
    data: {
      completedAt: new Date(),
      ...(typeof rowCount === "number" ? { rowCount } : {}),
      // Completion is the canonical retry-success state, so stale failure
      // metadata must not survive a later successful Shopify operation.
      failureCode: null,
      failureMessage: null,
      failureCategory: null,
      failureStage: null,
      retryable: null,
    },
  });
};

export const markBulkMutationFailed = async ({
  bulkMutationSubmissionId,
  failureCode = null,
  failureMessage = "Bulk mutation failed",
  failureCategory = null,
  failureStage = null,
  retryable = null,
}) => {
  return transitionBulkMutationSubmission({
    bulkMutationSubmissionId,
    nextStatus: SUBMISSION_STATUS.FAILED,
    data: {
      completedAt: new Date(),
      failureCode,
      failureMessage,
      failureCategory,
      failureStage,
      retryable,
    },
  });
};

export const markBulkMutationCancelled = async ({
  bulkMutationSubmissionId,
  failureCode = null,
  failureMessage = "Bulk mutation cancelled",
  failureCategory = null,
  failureStage = null,
  retryable = null,
}) => {
  return transitionBulkMutationSubmission({
    bulkMutationSubmissionId,
    nextStatus: SUBMISSION_STATUS.CANCELLED,
    data: {
      completedAt: new Date(),
      failureCode,
      failureMessage,
      failureCategory,
      failureStage,
      retryable,
    },
  });
};

export const getBulkMutationSubmissionByOperationId = async ({
  bulkOperationId,
  shop,
}) => {
  if (!bulkOperationId || typeof bulkOperationId !== "string") {
    throw new Error("bulkOperationId is required");
  }
  assertShop(shop);

  return bulkMutationSubmissionRepository.findBulkMutationSubmissionByOperationId(
    { bulkOperationId, shop },
  );
};

const assertBulkMutationSubmissionForOperation = (submission, {
  bulkOperationId,
  shop,
}) => {
  if (!submission?.id) {
    throw new BulkMutationSubmissionNotFoundError({ bulkOperationId, shop });
  }
};

const normalizeOutcomeStatus = (outcome, index, context) => {
  const status = outcome.status != null ? outcome.status : "UNKNOWN";

  if (status === "UNKNOWN") {
    logger.warn("Bulk mutation outcome has unknown status", {
      ...context,
      outcomeIndex: index,
      targetId: outcome.targetId || null,
      productId: outcome.productId || null,
      variantId: outcome.variantId || null,
      rawStatus: outcome.status,
    });
  }

  if (!Object.values(OUTCOME_STATUS).includes(status)) {
    throw new Error(`Invalid bulk mutation outcome status ${status}`);
  }

  return status;
};

const buildOutcomeDedupeKey = (outcome, index) => {
  if (outcome.dedupeKey) return String(outcome.dedupeKey);
  if (outcome.targetId) return `target:${outcome.targetId}`;
  if (outcome.productId || outcome.variantId) {
    return `product:${outcome.productId || ""}:variant:${outcome.variantId || ""}`;
  }
  if (outcome.raw?.lineNumber != null) {
    return `line:${outcome.raw.lineNumber}`;
  }
  return `row:${index}`;
};

const buildOutcomeRows = ({
  bulkMutationSubmissionId,
  shop,
  outcomes,
  targetSnapshotSetId = null,
  catalogBatchId = null,
}) =>
  outcomes.map((outcome, index) => ({
    bulkMutationSubmissionId,
    shop,
    targetSnapshotSetId: outcome.targetSnapshotSetId || targetSnapshotSetId,
    catalogBatchId: outcome.catalogBatchId || catalogBatchId,
    dedupeKey: buildOutcomeDedupeKey(outcome, index),
    targetId: outcome.targetId || null,
    productId: outcome.productId || null,
    variantId: outcome.variantId || null,
    status: normalizeOutcomeStatus(outcome, index, {
      bulkMutationSubmissionId,
      shop,
    }),
    code: outcome.code || null,
    message: outcome.message || null,
    raw: outcome.raw || null,
  }));

export const markBulkMutationCompletedByOperationId = async ({
  bulkOperationId,
  shop,
  rowCount = null,
}) => {
  const submission = await getBulkMutationSubmissionByOperationId({
    bulkOperationId,
    shop,
  });

  assertBulkMutationSubmissionForOperation(submission, { bulkOperationId, shop });

  return markBulkMutationCompleted({
    bulkMutationSubmissionId: submission.id,
    rowCount,
  });
};

export const markBulkMutationFailedByOperationId = async ({
  bulkOperationId,
  shop,
  failureCode = null,
  failureMessage = "Bulk mutation failed",
  failureCategory = null,
  failureStage = null,
  retryable = null,
}) => {
  const submission = await getBulkMutationSubmissionByOperationId({
    bulkOperationId,
    shop,
  });

  assertBulkMutationSubmissionForOperation(submission, { bulkOperationId, shop });

  return markBulkMutationFailed({
    bulkMutationSubmissionId: submission.id,
    failureCode,
    failureMessage,
    failureCategory,
    failureStage,
    retryable,
  });
};

export const recordBulkMutationOutcomes = async ({
  bulkMutationSubmissionId,
  shop,
  outcomes,
}) => {
  assertSubmissionId(bulkMutationSubmissionId);
  assertShop(shop);

  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    throw new Error("outcomes must be a non-empty array");
  }

  const submission =
    await bulkMutationSubmissionRepository.findBulkMutationSubmissionById(
      bulkMutationSubmissionId,
    );

  if (!submission?.id) {
    throw new Error(
      `Bulk mutation submission ${bulkMutationSubmissionId} was not found`,
    );
  }

  const rows = buildOutcomeRows({
    bulkMutationSubmissionId,
    shop,
    outcomes,
    targetSnapshotSetId: submission.targetSnapshotSetId,
    catalogBatchId: submission.batchId,
  });

  return bulkMutationOutcomeRepository.createManyBulkMutationOutcomes(rows);
};

export const recordBulkMutationOutcomesByOperationId = async ({
  bulkOperationId,
  shop,
  outcomes,
}) => {
  const submission = await getBulkMutationSubmissionByOperationId({
    bulkOperationId,
    shop,
  });

  assertBulkMutationSubmissionForOperation(submission, { bulkOperationId, shop });

  return recordBulkMutationOutcomes({
    bulkMutationSubmissionId: submission.id,
    shop,
    outcomes,
  });
};

export const completeBulkMutationByOperationId = async ({
  bulkOperationId,
  shop,
  outcomes = [],
  rowCount = null,
}) => {
  if (!bulkOperationId || typeof bulkOperationId !== "string") {
    throw new Error("bulkOperationId is required");
  }
  assertShop(shop);

  if (!Array.isArray(outcomes)) {
    throw new Error("outcomes must be an array");
  }
  assertValidRowCount(rowCount);

  const resolvedRowCount = outcomes.length || rowCount;

  return prisma.$transaction(async (tx) => {
    const submission =
      await bulkMutationSubmissionRepository.findBulkMutationSubmissionByOperationId(
        { bulkOperationId, shop },
        { tx },
      );

    assertBulkMutationSubmissionForOperation(submission, {
      bulkOperationId,
      shop,
    });

    if (submission.status === SUBMISSION_STATUS.COMPLETED) {
      return {
        submission,
        outcomeResult: { count: 0 },
        idempotent: true,
      };
    }

    const runningSubmission =
      submission.status === SUBMISSION_STATUS.SUBMITTED
        ? await transitionBulkMutationSubmission({
            bulkMutationSubmissionId: submission.id,
            nextStatus: SUBMISSION_STATUS.RUNNING,
            tx,
          })
        : submission;

    const outcomeResult = outcomes.length
      ? await bulkMutationOutcomeRepository.createManyBulkMutationOutcomes(
          buildOutcomeRows({
            bulkMutationSubmissionId: runningSubmission.id,
            shop,
            outcomes,
            targetSnapshotSetId: runningSubmission.targetSnapshotSetId,
            catalogBatchId: runningSubmission.batchId,
          }),
          { tx },
        )
      : { count: 0 };

    const completedSubmission = await transitionBulkMutationSubmission({
      bulkMutationSubmissionId: runningSubmission.id,
      nextStatus: SUBMISSION_STATUS.COMPLETED,
      data: {
        completedAt: new Date(),
        ...(typeof resolvedRowCount === "number"
          ? { rowCount: resolvedRowCount }
          : {}),
        // Completion is the canonical retry-success state, so stale failure
        // metadata must not survive a later successful Shopify operation.
        failureCode: null,
        failureMessage: null,
        failureCategory: null,
        failureStage: null,
        retryable: null,
      },
      tx,
    });

    return {
      submission: completedSubmission,
      outcomeResult,
    };
  });
};

export const getBulkMutationExecutionSummary = async (
  bulkMutationSubmissionId,
) => {
  assertSubmissionId(bulkMutationSubmissionId);

  const [submission, outcomeSummary] = await Promise.all([
    bulkMutationSubmissionRepository.findBulkMutationSubmissionById(
      bulkMutationSubmissionId,
    ),
    bulkMutationOutcomeRepository.summarizeOutcomesBySubmissionId(
      bulkMutationSubmissionId,
    ),
  ]);

  return {
    submission,
    outcomeSummary,
  };
};
