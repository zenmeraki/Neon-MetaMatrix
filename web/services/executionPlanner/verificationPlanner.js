import { prisma } from "../../config/database.js";
import { stableHash } from "../../utils/idempotencyKey.js";

export function buildVerificationPlan({
  operationId,
  mirrorBatchId,
  targetHash,
  expectedProductCount = 0,
  expectedVariantCount = 0,
}) {
  return {
    operationId,
    mirrorBatchId,
    targetHash,
    expectedProductCount: Number(expectedProductCount || 0),
    expectedVariantCount: Number(expectedVariantCount || 0),
  };
}

function getClient(db) {
  return db || prisma;
}

export async function verifyExecutionResults({
  shop,
  operationId,
  snapshotSetId,
}, db = prisma) {
  const client = getClient(db);
  const snapshotItems = await client.immutableTargetSnapshotItem.findMany({
    where: {
      shop,
      snapshotSetId,
    },
    orderBy: { ordinal: "asc" },
    select: {
      ordinal: true,
      productId: true,
      variantId: true,
      beforeFingerprint: true,
    },
  });

  const mismatches = [];
  for (const item of snapshotItems) {
    const mutation = await client.operationMutation.findFirst({
      where: {
        shop,
        operationId,
        entityId: item.variantId || item.productId,
      },
      select: { status: true },
    });
    if (!mutation || mutation.status !== "APPLIED") {
      mismatches.push({
        ordinal: item.ordinal,
        productId: item.productId,
        variantId: item.variantId,
        reason: "MUTATION_NOT_APPLIED",
      });
    }
  }

  const verificationHash = stableHash({
    operationId,
    snapshotSetId,
    checked: snapshotItems.length,
    mismatches,
  });

  return {
    checkedCount: snapshotItems.length,
    mismatchCount: mismatches.length,
    mismatches,
    verificationHash,
    verified: mismatches.length === 0,
  };
}

export function assertVerificationBeforeCompletion(verificationResult) {
  if (!verificationResult?.verified) {
    const error = new Error("VERIFICATION_REQUIRED_BEFORE_COMPLETION");
    error.code = "VERIFICATION_REQUIRED_BEFORE_COMPLETION";
    error.details = {
      mismatchCount: Number(verificationResult?.mismatchCount || 0),
    };
    throw error;
  }
}
