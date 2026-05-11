import axios from "axios";
import { createInterface } from "node:readline";
import crypto from "crypto";
import { prisma } from "../../config/database.js";
import { persistChangeRecords } from "../undo/changeRecordService.js";
import {
  UNDO_REQUEST_STATUS,
  UNDO_TARGET_STATUS,
} from "../undo/undoStatus.constants.js";
import { transitionUndoRequestStatus } from "../undo/undoTransitionGuard.js";
import {
  assertShadowExternalCallsAllowed,
  assertShadowWriteAllowed,
} from "../shadowReadOnlyGuardService.js";

function chunkArray(items, size = 1000) {
  const source = Array.isArray(items) ? items : [];
  const chunkSize = Math.max(1, Number(size) || 1000);
  const chunks = [];
  for (let index = 0; index < source.length; index += chunkSize) {
    chunks.push(source.slice(index, index + chunkSize));
  }
  return chunks;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function collectLineErrors(parsed) {
  const errors = [];
  errors.push(...asArray(parsed?.errors).map((item) => item?.message || "graphql_error"));
  errors.push(
    ...asArray(parsed?.data?.productSet?.userErrors).map(
      (item) => item?.message || "product_set_user_error",
    ),
  );
  errors.push(
    ...asArray(parsed?.data?.productSet?.productSetOperation?.userErrors).map(
      (item) => item?.message || "product_set_operation_user_error",
    ),
  );
  errors.push(
    ...asArray(parsed?.data?.productDelete?.userErrors).map(
      (item) => item?.message || "product_delete_user_error",
    ),
  );
  return errors;
}

function parseLineOutcome(parsed) {
  const errors = collectLineErrors(parsed);
  const deletedProductId = parsed?.data?.productDelete?.deletedProductId || null;
  const product = parsed?.data?.productSet?.product || null;
  const productId = deletedProductId || product?.id || null;
  const variantIds = product
    ? asArray(product?.variants?.edges)
        .map((edge) => edge?.node?.id)
        .filter(Boolean)
    : [];

  return {
    productId,
    variantIds,
    hasErrors: errors.length > 0 || !productId,
    errors,
  };
}

function fingerprintOutcome(outcome = {}) {
  const payload = {
    totalLines: Number(outcome?.totalLines || 0),
    successLines: Number(outcome?.successLines || 0),
    failedLines: Number(outcome?.failedLines || 0),
    successEntityIds: Array.from(outcome?.successEntityIds || []).sort(),
    failedEntityIds: Array.from(outcome?.failedEntityIds || []).sort(),
  };

  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function processResultUrl(url, accumulator, executionContext = null) {
  if (!url) return;
  assertShadowExternalCallsAllowed(
    executionContext,
    "bulk_mutation_finalizer.process_result_url",
  );

  const response = await axios.get(url, {
    responseType: "stream",
    timeout: 120000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  const reader = createInterface({
    input: response.data,
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    if (!line) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (_error) {
      accumulator.failedLines += 1;
      continue;
    }

    const outcome = parseLineOutcome(parsed);
    accumulator.totalLines += 1;

    if (outcome.hasErrors) {
      accumulator.failedLines += 1;
      if (outcome.productId) {
        accumulator.failedProductIds.add(outcome.productId);
      }
      for (const id of outcome.variantIds) {
        accumulator.failedEntityIds.add(id);
      }
      if (outcome.productId) {
        accumulator.failedEntityIds.add(outcome.productId);
      }
      continue;
    }

    accumulator.successLines += 1;
    accumulator.successProductIds.add(outcome.productId);
    accumulator.successEntityIds.add(outcome.productId);
    for (const id of outcome.variantIds) {
      accumulator.successEntityIds.add(id);
    }
  }
}

export const bulkMutationFinalizerService = {
  buildSubmissionCorrelationWhere({
    shop,
    operationId,
    batchId,
    bulkOperationId,
    editHistoryId = null,
    dispatchJobId = null,
    dispatchAttempt = null,
  }) {
    return {
      shop,
      operationId,
      batchId,
      ...(editHistoryId ? { editHistoryId } : {}),
      shopifyBulkOperationId: bulkOperationId,
      ...(dispatchJobId ? { dispatchJobId } : {}),
      ...(Number.isInteger(dispatchAttempt) ? { dispatchAttempt } : {}),
    };
  },

  assertStrictBulkEditCorrelationArgs(args = {}) {
    const required = ["shop", "operationId", "batchId", "bulkOperationId", "editHistoryId", "dispatchJobId"];
    for (const key of required) {
      if (!args?.[key]) {
        const error = new Error(`MISSING_${key}_FOR_BULK_EDIT_CORRELATION`);
        error.code = `MISSING_${key}_FOR_BULK_EDIT_CORRELATION`;
        throw error;
      }
    }
    if (!Number.isInteger(args.dispatchAttempt)) {
      const error = new Error("MISSING_dispatchAttempt_FOR_BULK_EDIT_CORRELATION");
      error.code = "MISSING_dispatchAttempt_FOR_BULK_EDIT_CORRELATION";
      throw error;
    }
  },

  async assertSubmissionCorrelation(args, tx) {
    const submission = await tx.bulkMutationSubmission.findFirst({
      where: this.buildSubmissionCorrelationWhere(args),
      select: { id: true },
    });
    if (!submission) {
      const error = new Error("BULK_MUTATION_SUBMISSION_CORRELATION_MISMATCH");
      error.code = "BULK_MUTATION_SUBMISSION_CORRELATION_MISMATCH";
      throw error;
    }
  },

  async ensureBulkEditSubmissionCorrelation(args) {
    this.assertStrictBulkEditCorrelationArgs(args);
    await prisma.$transaction(async (tx) => {
      await this.assertSubmissionCorrelation(args, tx);
    });
  },

  async claimWebhookAwaitingSubmission({
    shop,
    operationId,
    bulkOperationId,
    dispatchJobId,
    dispatchAttempt,
    executionContext = null,
  }) {
    if (!shop || !operationId || !bulkOperationId || !dispatchJobId || !Number.isInteger(dispatchAttempt)) {
      const error = new Error("MISSING_SUBMISSION_CORRELATION_FOR_WEBHOOK_CLAIM");
      error.code = "MISSING_SUBMISSION_CORRELATION_FOR_WEBHOOK_CLAIM";
      throw error;
    }

    assertShadowWriteAllowed(
      executionContext,
      "bulk_mutation_finalizer.claim_webhook_submission",
    );
    const claimed = await prisma.operationSubmission.updateMany({
      where: {
        shop,
        merchantOperationId: operationId,
        bulkOperationId,
        dispatchJobId,
        dispatchAttempt,
        status: "AWAITING_SHOPIFY",
      },
      data: {
        status: "SUBMITTED",
      },
    });

    if (claimed.count !== 1) {
      const error = new Error("WEBHOOK_SUBMISSION_NOT_AWAITING_SHOPIFY");
      error.code = "WEBHOOK_SUBMISSION_NOT_AWAITING_SHOPIFY";
      throw error;
    }
  },

  async completeWebhookSubmission({
    shop,
    operationId,
    bulkOperationId,
    dispatchJobId,
    dispatchAttempt,
    resultUrl = null,
    executionContext = null,
  }) {
    assertShadowWriteAllowed(
      executionContext,
      "bulk_mutation_finalizer.complete_webhook_submission",
    );
    const completed = await prisma.operationSubmission.updateMany({
      where: {
        shop,
        merchantOperationId: operationId,
        bulkOperationId,
        dispatchJobId,
        dispatchAttempt,
        status: "SUBMITTED",
      },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        ...(resultUrl ? { resultUrl } : {}),
      },
    });

    if (completed.count !== 1) {
      const error = new Error("WEBHOOK_SUBMISSION_COMPLETE_CONFLICT");
      error.code = "WEBHOOK_SUBMISSION_COMPLETE_CONFLICT";
      throw error;
    }
  },

  async failWebhookSubmission({
    shop,
    operationId,
    bulkOperationId,
    dispatchJobId,
    dispatchAttempt,
    errorCode,
    errorMessage,
    executionContext = null,
  }) {
    assertShadowWriteAllowed(
      executionContext,
      "bulk_mutation_finalizer.fail_webhook_submission",
    );
    const failed = await prisma.operationSubmission.updateMany({
      where: {
        shop,
        merchantOperationId: operationId,
        bulkOperationId,
        dispatchJobId,
        dispatchAttempt,
        status: "SUBMITTED",
      },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorCode: errorCode || "SHOPIFY_BULK_OPERATION_FAILED",
        errorMessage: errorMessage || "Shopify bulk operation failed",
      },
    });

    if (failed.count !== 1) {
      const error = new Error("WEBHOOK_SUBMISSION_FAIL_CONFLICT");
      error.code = "WEBHOOK_SUBMISSION_FAIL_CONFLICT";
      throw error;
    }
  },

  async collectOutcome({ resultUrl, partialDataUrl, executionContext = null }) {
    const accumulator = {
      totalLines: 0,
      successLines: 0,
      failedLines: 0,
      successProductIds: new Set(),
      failedProductIds: new Set(),
      successEntityIds: new Set(),
      failedEntityIds: new Set(),
    };

    await processResultUrl(resultUrl, accumulator, executionContext);
    await processResultUrl(partialDataUrl, accumulator, executionContext);

    return accumulator;
  },

  async reconcileBulkEdit({
    shop,
    operationId,
    batchId,
    bulkOperationId,
    editHistoryId,
    outcome,
    dispatchJobId = null,
    dispatchAttempt = null,
    executionContext = null,
  }) {
    if (!shop || !operationId || !batchId) return;
    this.assertStrictBulkEditCorrelationArgs({
      shop,
      operationId,
      batchId,
      bulkOperationId,
      editHistoryId,
      dispatchJobId,
      dispatchAttempt,
    });

    const succeededProducts = Array.from(outcome.successProductIds);
    const failedProducts = Array.from(outcome.failedProductIds);
    const succeededEntities = Array.from(outcome.successEntityIds);
    const failedEntities = Array.from(outcome.failedEntityIds);

    assertShadowWriteAllowed(
      executionContext,
      "bulk_mutation_finalizer.reconcile_bulk_edit",
    );
    await prisma.$transaction(async (tx) => {
      await this.assertSubmissionCorrelation(
        {
          shop,
          operationId,
          batchId,
          bulkOperationId,
          editHistoryId,
          dispatchJobId,
          dispatchAttempt,
        },
        tx,
      );

      const history = await tx.editHistory.findFirst({
        where: { id: editHistoryId, shop },
        select: {
          executionIdentity: true,
          summary: true,
          batch: true,
        },
      });

      const summary =
        history?.summary && typeof history.summary === "object" ? history.summary : {};
      const batch =
        history?.batch && typeof history.batch === "object" ? history.batch : {};
      const intentHash =
        typeof summary?.intentId === "string" && summary.intentId.trim()
          ? summary.intentId.trim()
          : typeof batch?.intentId === "string" && batch.intentId.trim()
            ? batch.intentId.trim()
            : null;
      const snapshotSetId =
        typeof batch?.sourceTargetSnapshotId === "string" &&
        batch.sourceTargetSnapshotId.trim()
          ? batch.sourceTargetSnapshotId.trim()
          : null;

      if (succeededProducts.length > 0) {
        if (history?.executionIdentity && intentHash && snapshotSetId) {
          const successRows = await tx.changeRecord.findMany({
            where: {
              shop,
              operationId,
              batchId,
              status: "submitted",
              productId: { in: succeededProducts },
              field: { not: null },
            },
            select: {
              editHistoryId: true,
              productId: true,
              variantId: true,
              field: true,
              beforeValueJson: true,
              afterValueJson: true,
              beforeValue: true,
              afterValue: true,
              title: true,
              scope: true,
            },
          });

          const normalizedMutations = successRows
            .map((row) => ({
              editHistoryId: row.editHistoryId,
              productId: row.productId,
              variantId: row.variantId || null,
              field: row.field,
              beforeValueJson: row.beforeValueJson ?? row.beforeValue ?? null,
              afterValueJson: row.afterValueJson ?? row.afterValue ?? null,
              title: row.title || "Bulk edit change",
              scope: row.scope || "safe_undo",
            }))
            .filter((row) => row.field);

          if (normalizedMutations.length > 0) {
            await persistChangeRecords(
              {
                shop,
                executionId: history.executionIdentity,
                intentHash,
                snapshotSetId,
                mutations: normalizedMutations,
              },
              tx,
            );
          }
        }

        for (const chunk of chunkArray(succeededProducts, 1000)) {
          await tx.changeRecord.updateMany({
            where: { shop, operationId, batchId, productId: { in: chunk } },
            data: { status: "completed" },
          });
        }
      }

      if (failedProducts.length > 0) {
        for (const chunk of chunkArray(failedProducts, 1000)) {
          await tx.changeRecord.updateMany({
            where: { shop, operationId, batchId, productId: { in: chunk } },
            data: { status: "failed" },
          });
        }
      }

      if (succeededEntities.length > 0) {
        for (const chunk of chunkArray(succeededEntities, 1000)) {
          await tx.operationMutation.updateMany({
            where: { shop, operationId, batchId, entityId: { in: chunk } },
            data: { status: "APPLIED", shopifyBulkOperationId: bulkOperationId || null },
          });
        }
      }

      if (failedEntities.length > 0) {
        for (const chunk of chunkArray(failedEntities, 1000)) {
          await tx.operationMutation.updateMany({
            where: { shop, operationId, batchId, entityId: { in: chunk } },
            data: { status: "FAILED", shopifyBulkOperationId: bulkOperationId || null },
          });
        }
      }

      await tx.bulkMutationSubmission.updateMany({
        where: this.buildSubmissionCorrelationWhere({
          shop,
          operationId,
          batchId,
          bulkOperationId,
          editHistoryId,
          dispatchJobId,
          dispatchAttempt,
        }),
        data: {
          status: outcome.failedLines > 0 ? "FAILED" : "COMPLETED",
          error:
            outcome.failedLines > 0
              ? {
                  code: "SHOPIFY_BULK_RESULT_HAS_ERRORS",
                  message: "Bulk mutation completed with line-level errors",
                  failedLines: outcome.failedLines,
                  totalLines: outcome.totalLines,
                }
              : null,
        },
      });

      const expectedFingerprint = crypto
        .createHash("sha256")
        .update(
          JSON.stringify({
            totalLines: Number(outcome.totalLines || 0),
            expectedLineCount:
              Number(outcome.successLines || 0) + Number(outcome.failedLines || 0),
          }),
        )
        .digest("hex");
      const actualFingerprint = fingerprintOutcome(outcome);
      const verified =
        Number(outcome.totalLines || 0) ===
          Number(outcome.successLines || 0) + Number(outcome.failedLines || 0) &&
        Number(outcome.failedLines || 0) === 0;

      await tx.verificationResult.create({
        data: {
          shop,
          operationId,
          partitionId: null,
          expectedFingerprint,
          actualFingerprint,
          verified,
          mismatchReason: verified ? null : "SHOPIFY_RESULT_VERIFICATION_MISMATCH",
        },
      });
    });
  },

  async reconcileBulkUndo({
    shop,
    operationId,
    bulkOperationId,
    outcome,
    executionContext = null,
  }) {
    if (!shop || !operationId) return;
    assertShadowWriteAllowed(
      executionContext,
      "bulk_mutation_finalizer.reconcile_bulk_undo",
    );

    const succeededEntities = Array.from(outcome.successEntityIds);
    const failedEntities = Array.from(outcome.failedEntityIds);

    await prisma.$transaction(async (tx) => {
      const undoRequest = await tx.undoRequest.findFirst({
        where: {
          shop,
          executionId: operationId,
        },
        select: { id: true },
      });

      if (succeededEntities.length > 0) {
        for (const chunk of chunkArray(succeededEntities, 1000)) {
          await tx.operationMutation.updateMany({
            where: { shop, operationId, entityId: { in: chunk } },
            data: { status: "APPLIED", shopifyBulkOperationId: bulkOperationId || null },
          });
          if (undoRequest?.id) {
            await tx.undoTarget.updateMany({
              where: {
                shop,
                undoRequestId: undoRequest.id,
                restoredAt: null,
                OR: [
                  { variantId: { in: chunk } },
                  { variantId: null, productId: { in: chunk } },
                ],
              },
              data: {
                status: UNDO_TARGET_STATUS.RESTORED,
                conflictReason: null,
                restoredAt: new Date(),
                undoMutationId: bulkOperationId || null,
              },
            });
          }
        }
      }

      if (failedEntities.length > 0) {
        for (const chunk of chunkArray(failedEntities, 1000)) {
          await tx.operationMutation.updateMany({
            where: { shop, operationId, entityId: { in: chunk } },
            data: { status: "FAILED", shopifyBulkOperationId: bulkOperationId || null },
          });
          if (undoRequest?.id) {
            await tx.undoTarget.updateMany({
              where: {
                shop,
                undoRequestId: undoRequest.id,
                restoredAt: null,
                OR: [
                  { variantId: { in: chunk } },
                  { variantId: null, productId: { in: chunk } },
                ],
              },
              data: {
                status: UNDO_TARGET_STATUS.FAILED,
                conflictReason: "SHOPIFY_UNDO_MUTATION_FAILED",
                undoMutationId: bulkOperationId || null,
              },
            });
          }
        }
      }

      if (undoRequest?.id) {
        await tx.undoTarget.updateMany({
          where: {
            shop,
            undoRequestId: undoRequest.id,
            status: {
              in: [
                UNDO_TARGET_STATUS.SAFE,
                UNDO_TARGET_STATUS.DISPATCHED,
                UNDO_TARGET_STATUS.PENDING,
              ],
            },
          },
          data: {
            status: UNDO_TARGET_STATUS.SKIPPED,
            conflictReason: "UNDO_TARGET_NOT_RESTORED_IN_RESULT",
            undoMutationId: bulkOperationId || null,
          },
        });

        const grouped = await tx.undoTarget.groupBy({
          by: ["status"],
          where: {
            shop,
            undoRequestId: undoRequest.id,
          },
          _count: { _all: true },
        });
        const counts = grouped.reduce((acc, item) => {
          acc[item.status] = Number(item._count?._all || 0);
          return acc;
        }, {});
        const restoredCount = Number(counts[UNDO_TARGET_STATUS.RESTORED] || 0);
        const failedCount = Number(counts[UNDO_TARGET_STATUS.FAILED] || 0);
        const skippedCount = Number(counts[UNDO_TARGET_STATUS.SKIPPED] || 0);
        const conflictCount = Number(counts[UNDO_TARGET_STATUS.CONFLICT] || 0);

        const nextStatus =
          restoredCount > 0 && failedCount === 0 && skippedCount === 0 && conflictCount === 0
            ? UNDO_REQUEST_STATUS.COMPLETED
            : restoredCount > 0
              ? UNDO_REQUEST_STATUS.PARTIAL_COMPLETED
              : UNDO_REQUEST_STATUS.FAILED;

        await transitionUndoRequestStatus({
          shop,
          undoRequestId: undoRequest.id,
          toStatus: nextStatus,
          db: tx,
        });

        await tx.undoRequest.updateMany({
          where: { id: undoRequest.id, shop },
          data: {
            safeCount: restoredCount,
            conflictCount,
            skippedCount: skippedCount + failedCount,
          },
        });
      }

      const expectedFingerprint = crypto
        .createHash("sha256")
        .update(
          JSON.stringify({
            totalLines: Number(outcome.totalLines || 0),
            expectedLineCount:
              Number(outcome.successLines || 0) + Number(outcome.failedLines || 0),
          }),
        )
        .digest("hex");
      const actualFingerprint = fingerprintOutcome(outcome);
      const verified =
        Number(outcome.totalLines || 0) ===
          Number(outcome.successLines || 0) + Number(outcome.failedLines || 0) &&
        Number(outcome.failedLines || 0) === 0;

      await tx.verificationResult.create({
        data: {
          shop,
          operationId,
          partitionId: null,
          expectedFingerprint,
          actualFingerprint,
          verified,
          mismatchReason: verified ? null : "SHOPIFY_UNDO_VERIFICATION_MISMATCH",
        },
      });
    });
  },

  async markSubmissionFailed({
    shop,
    operationId,
    batchId,
    bulkOperationId,
    editHistoryId,
    reason,
    dispatchJobId = null,
    dispatchAttempt = null,
    executionContext = null,
  }) {
    if (!shop || !operationId || !batchId) return;
    this.assertStrictBulkEditCorrelationArgs({
      shop,
      operationId,
      batchId,
      bulkOperationId,
      editHistoryId,
      dispatchJobId,
      dispatchAttempt,
    });

    assertShadowWriteAllowed(
      executionContext,
      "bulk_mutation_finalizer.mark_submission_failed",
    );
    await prisma.$transaction(async (tx) => {
      await this.assertSubmissionCorrelation(
        {
          shop,
          operationId,
          batchId,
          bulkOperationId,
          editHistoryId,
          dispatchJobId,
          dispatchAttempt,
        },
        tx,
      );

      await tx.bulkMutationSubmission.updateMany({
        where: this.buildSubmissionCorrelationWhere({
          shop,
          operationId,
          batchId,
          bulkOperationId,
          editHistoryId,
          dispatchJobId,
          dispatchAttempt,
        }),
        data: {
          status: "FAILED",
          error: {
            code: "SHOPIFY_BULK_OPERATION_FAILED",
            message: reason || "Shopify bulk operation failed",
          },
        },
      });
    });
  },
};
