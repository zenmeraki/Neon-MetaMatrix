import { prisma } from "../../config/database.js";
import crypto from "crypto";
import {
  UNDO_REQUEST_STATUS,
  UNDO_TARGET_STATUS,
} from "./undoStatus.constants.js";
import { transitionUndoRequestStatus } from "./undoTransitionGuard.js";
import { UNDO_CONFLICT_REASONS } from "./undoConflictReasons.js";

function valuesEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function hashValue(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex");
}

function normalizeFieldKey(field) {
  const key = String(field || "")
    .replace(/^product\./, "")
    .replace(/^variant\./, "");
  return key;
}

async function getCurrentMirrorValue(tx, { shop, productId, variantId, field }) {
  if (String(field).startsWith("product.")) {
    const product = await tx.product.findFirst({
      where: {
        shop,
        id: productId,
      },
    });

    if (!product) return { missing: true, value: null, missingReason: UNDO_CONFLICT_REASONS.PRODUCT_MISSING };
    const key = normalizeFieldKey(field);
    return { missing: false, value: { field: product[key] ?? null }, missingReason: null };
  }

  if (String(field).startsWith("variant.")) {
    const variant = await tx.variant.findFirst({
      where: {
        shop,
        id: variantId || "",
      },
    });

    if (!variant) return { missing: true, value: null, missingReason: UNDO_CONFLICT_REASONS.VARIANT_MISSING };
    const key = normalizeFieldKey(field);
    return { missing: false, value: { field: variant[key] ?? null }, missingReason: null };
  }
  return {
    missing: true,
    value: null,
    missingReason: UNDO_CONFLICT_REASONS.FIELD_NOT_SUPPORTED_FOR_UNDO,
  };
}

export async function scanUndoConflicts({ shop, undoRequestId }) {
  return prisma.$transaction(async (tx) => {
    await transitionUndoRequestStatus({
      shop,
      undoRequestId,
      toStatus: "VALIDATING_CURRENT_STATE",
      db: tx,
    });

    const targets = await tx.undoTarget.findMany({
      where: {
        shop,
        undoRequestId,
        status: UNDO_TARGET_STATUS.PENDING,
      },
      orderBy: [{ productId: "asc" }, { variantId: "asc" }, { field: "asc" }],
    });

    let safeCount = 0;
    let conflictCount = 0;
    const undoRequest = await tx.undoRequest.findFirst({
      where: { id: undoRequestId, shop },
      select: { executionId: true },
    });
    const execution = undoRequest?.executionId
      ? await tx.bulkUndoExecution.findFirst({
          where: { shop, executionIdentity: undoRequest.executionId },
          select: { mirrorBatchId: true },
        })
      : null;
    const store = await tx.store.findFirst({
      where: { shopUrl: shop },
      select: { activeMirrorBatchId: true },
    });
    const mirrorStale =
      Boolean(execution?.mirrorBatchId) &&
      Boolean(store?.activeMirrorBatchId) &&
      execution.mirrorBatchId !== store.activeMirrorBatchId;

    for (const target of targets) {
      const currentMirror = await getCurrentMirrorValue(tx, target);
      const currentValueJson = currentMirror?.value ?? null;
      const currentFingerprint = hashValue(currentValueJson);

      let safe = false;
      let reason = null;
      if (mirrorStale) {
        reason = UNDO_CONFLICT_REASONS.SHOPIFY_SYNC_STALE;
      } else if (currentMirror?.missing) {
        reason = currentMirror.missingReason;
      } else if (
        target.expectedAfterFingerprint &&
        target.expectedAfterFingerprint !== currentFingerprint
      ) {
        reason = UNDO_CONFLICT_REASONS.CURRENT_VALUE_DIFFERS_FROM_AFTER_VALUE;
      } else if (!valuesEqual(currentValueJson, target.afterValueJson)) {
        const sourceChange = await tx.changeRecord.findFirst({
          where: { id: target.changeRecordId, shop },
          select: { appliedAt: true, executionId: true },
        });
        const touchedByOtherOp =
          sourceChange?.appliedAt &&
          (await tx.changeRecord.findFirst({
            where: {
              shop,
              productId: target.productId,
              variantId: target.variantId,
              field: target.field,
              appliedAt: { gt: sourceChange.appliedAt },
              executionId: { not: sourceChange.executionId || null },
            },
            select: { id: true },
          }));
        reason = touchedByOtherOp
          ? UNDO_CONFLICT_REASONS.ANOTHER_OPERATION_TOUCHED_FIELD
          : UNDO_CONFLICT_REASONS.CURRENT_VALUE_DIFFERS_FROM_AFTER_VALUE;
      } else {
        safe = true;
      }

      await tx.undoTarget.update({
        where: { id: target.id },
        data: {
          currentValueJson,
          currentFingerprint,
          status: safe ? UNDO_TARGET_STATUS.SAFE : UNDO_TARGET_STATUS.CONFLICT,
          conflictReason: safe ? null : reason,
        },
      });

      if (safe) safeCount += 1;
      else conflictCount += 1;
    }

    const finalStatus =
      conflictCount > 0
        ? "VALIDATED_WITH_CONFLICTS"
        : "VALIDATED_SAFE";

    await transitionUndoRequestStatus({
      shop,
      undoRequestId,
      toStatus: finalStatus,
      db: tx,
    });

    await tx.undoRequest.updateMany({
      where: { id: undoRequestId, shop },
      data: {
        safeCount,
        conflictCount,
        skippedCount: conflictCount,
      },
    });

    return {
      safeCount,
      conflictCount,
    };
  });
}
