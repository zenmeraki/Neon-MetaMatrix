import crypto from "crypto";
import { prisma } from "../../config/database.js";

function hashTarget({ productId, variantId, field, beforeValueJson, afterValueJson }) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        productId,
        variantId: variantId ?? null,
        field,
        beforeValueJson,
        afterValueJson,
      }),
    )
    .digest("hex");
}

function hashValue(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex");
}

function hasValue(value) {
  return value !== undefined && value !== null;
}

function assertRequiredField(value, code) {
  if (!hasValue(value) || (typeof value === "string" && !value.trim())) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
}

export async function persistChangeRecords({
  shop,
  executionId,
  intentHash,
  snapshotSetId,
  mutations,
}, db = prisma) {
  assertRequiredField(executionId, "EXECUTION_ID_REQUIRED");
  assertRequiredField(shop, "SHOP_REQUIRED");
  assertRequiredField(intentHash, "INTENT_HASH_REQUIRED");
  assertRequiredField(snapshotSetId, "SNAPSHOT_SET_ID_REQUIRED");

  const safeMutations = Array.isArray(mutations) ? mutations : [];
  if (safeMutations.some((mutation) => !mutation?.editHistoryId)) {
    throw new Error("EDIT_HISTORY_ID_REQUIRED_FOR_CHANGE_RECORD");
  }

  const appliedAt = new Date();
  const records = safeMutations.map((mutation) => {
    assertRequiredField(mutation?.editHistoryId, "CHANGE_RECORD_LINEAGE_REQUIRED");
    assertRequiredField(mutation?.productId, "CHANGE_RECORD_LINEAGE_REQUIRED");
    assertRequiredField(mutation?.field, "CHANGE_RECORD_LINEAGE_REQUIRED");
    if (!hasValue(mutation?.beforeValueJson) || !hasValue(mutation?.afterValueJson)) {
      const error = new Error("CHANGE_RECORD_BEFORE_AFTER_REQUIRED");
      error.code = "CHANGE_RECORD_BEFORE_AFTER_REQUIRED";
      throw error;
    }

    return {
      shop,
      executionId,
      intentHash,
      snapshotSetId,
      editHistoryId: mutation.editHistoryId,
      productId: mutation.productId,
      variantId: mutation.variantId ?? null,
      field: mutation.field,
      beforeValueJson: mutation.beforeValueJson,
      afterValueJson: mutation.afterValueJson,
      beforeFingerprint: hashValue(mutation.beforeValueJson),
      afterFingerprint: hashValue(mutation.afterValueJson),
      targetHash: hashTarget(mutation),
      appliedAt: mutation.appliedAt ? new Date(mutation.appliedAt) : appliedAt,
      title: mutation.title || "Bulk edit change",
      scope: mutation.scope || "safe_undo",
      status: mutation.status || "completed",
    };
  });

  if (!records.length) return 0;

  await db.changeRecord.createMany({
    data: records,
    skipDuplicates: true,
  });

  return records.length;
}
