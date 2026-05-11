import crypto from "crypto";
import { prisma } from "../../config/database.js";
import { stableCanonicalStringify } from "../../utils/stableCanonicalStringify.js";

export const OPERATION_SPINE_STAGES = Object.freeze([
  "MirrorBatch",
  "CanonicalFilterAST",
  "TargetSnapshotSet",
  "ExecutionPlan",
  "BeforeValueSnapshot",
  "ShopifyBulkMutation",
  "VerificationSnapshot",
  "UndoPlan",
]);

const CAPABILITY_REQUIREMENTS = Object.freeze({
  previewable: ["MirrorBatch", "CanonicalFilterAST"],
  freezable: ["MirrorBatch", "CanonicalFilterAST", "TargetSnapshotSet"],
  verifiable: ["ExecutionPlan", "BeforeValueSnapshot", "ShopifyBulkMutation", "VerificationSnapshot"],
  undoable: ["BeforeValueSnapshot", "ShopifyBulkMutation", "VerificationSnapshot", "UndoPlan"],
  replayable: ["MirrorBatch", "CanonicalFilterAST", "TargetSnapshotSet", "ExecutionPlan"],
  explainable: ["CanonicalFilterAST", "TargetSnapshotSet", "ExecutionPlan"],
  auditable: OPERATION_SPINE_STAGES,
});

function hash(value) {
  return crypto
    .createHash("sha256")
    .update(stableCanonicalStringify(value))
    .digest("hex");
}

function normalizeEvidence(stage, evidence) {
  if (!evidence) {
    return {
      stage,
      present: false,
    };
  }

  const normalized = {
    stage,
    present: true,
    id: evidence.id ?? evidence.stageId ?? null,
    hash: evidence.hash ?? evidence.fingerprint ?? evidence.planHash ?? evidence.targetHash ?? null,
    count: Number.isFinite(Number(evidence.count)) ? Number(evidence.count) : null,
    status: evidence.status ?? null,
    metadata: evidence.metadata ?? null,
  };

  return {
    ...normalized,
    evidenceHash: hash(normalized),
  };
}

function stageMapFromInput(input = {}) {
  return {
    MirrorBatch: normalizeEvidence("MirrorBatch", input.mirrorBatch),
    CanonicalFilterAST: normalizeEvidence("CanonicalFilterAST", input.canonicalFilterAst),
    TargetSnapshotSet: normalizeEvidence("TargetSnapshotSet", input.targetSnapshotSet),
    ExecutionPlan: normalizeEvidence("ExecutionPlan", input.executionPlan),
    BeforeValueSnapshot: normalizeEvidence("BeforeValueSnapshot", input.beforeValueSnapshot),
    ShopifyBulkMutation: normalizeEvidence("ShopifyBulkMutation", input.shopifyBulkMutation),
    VerificationSnapshot: normalizeEvidence("VerificationSnapshot", input.verificationSnapshot),
    UndoPlan: normalizeEvidence("UndoPlan", input.undoPlan),
  };
}

export function assertOperationSpine(spine) {
  const stages = spine?.stages || {};
  const presentStages = OPERATION_SPINE_STAGES.filter((stage) => stages[stage]?.present);
  const firstMissingIndex = OPERATION_SPINE_STAGES.findIndex((stage) => !stages[stage]?.present);
  const outOfOrder =
    firstMissingIndex >= 0
      ? presentStages.filter((stage) => OPERATION_SPINE_STAGES.indexOf(stage) > firstMissingIndex)
      : [];

  if (outOfOrder.length) {
    const error = new Error("OPERATION_SPINE_OUT_OF_ORDER");
    error.code = "OPERATION_SPINE_OUT_OF_ORDER";
    error.details = {
      firstMissingStage: OPERATION_SPINE_STAGES[firstMissingIndex],
      outOfOrder,
    };
    throw error;
  }

  return true;
}

export function buildOperationSpine(input = {}) {
  const stages = stageMapFromInput(input);
  const completeThrough =
    OPERATION_SPINE_STAGES.reduce((last, stage, index) => {
      if (last !== index - 1) return last;
      return stages[stage]?.present ? index : last;
    }, -1);
  const missingStages = OPERATION_SPINE_STAGES.filter((stage) => !stages[stage]?.present);
  const capabilities = Object.fromEntries(
    Object.entries(CAPABILITY_REQUIREMENTS).map(([capability, requiredStages]) => [
      capability,
      requiredStages.every((stage) => stages[stage]?.present),
    ]),
  );
  const spine = {
    schemaVersion: "2026-05-10.operationSpine.v1",
    shop: input.shop ?? null,
    operationId: input.operationId ?? null,
    stages,
    completeThroughStage: completeThrough >= 0 ? OPERATION_SPINE_STAGES[completeThrough] : null,
    missingStages,
    capabilities,
  };

  spine.spineHash = hash({
    schemaVersion: spine.schemaVersion,
    shop: spine.shop,
    operationId: spine.operationId,
    stages,
  });
  assertOperationSpine(spine);
  return spine;
}

export function explainOperationSpine(spine) {
  const stages = spine?.stages || {};
  return OPERATION_SPINE_STAGES.map((stage) => {
    const evidence = stages[stage] || { present: false };
    return {
      stage,
      present: Boolean(evidence.present),
      id: evidence.id || null,
      hash: evidence.hash || evidence.evidenceHash || null,
      status: evidence.status || null,
      count: evidence.count ?? null,
    };
  });
}

export async function loadOperationSpine({ shop, operationId }, db = prisma) {
  if (!shop || !operationId) {
    const error = new Error("OPERATION_SPINE_ID_REQUIRED");
    error.code = "OPERATION_SPINE_ID_REQUIRED";
    throw error;
  }

  const client = db || prisma;
  const operation = await client.merchantOperation.findFirst({
    where: { shop, id: operationId },
    select: {
      id: true,
      shop: true,
      targetHash: true,
      status: true,
      bulkEditIntents: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          mirrorBatchId: true,
          filterAst: true,
          canonicalFilterHash: true,
          intentHash: true,
        },
      },
    },
  });

  if (!operation) {
    const error = new Error("OPERATION_NOT_FOUND");
    error.code = "OPERATION_NOT_FOUND";
    throw error;
  }

  const [snapshotSet, executionPlan, beforeSample, beforeCount, submission, verification, undoRequest] =
    await Promise.all([
      client.immutableTargetSnapshotSet.findFirst({
        where: { shop, operationId },
        select: {
          id: true,
          mirrorBatchId: true,
          targetHash: true,
          productCount: true,
          variantCount: true,
          filterHash: true,
        },
      }),
      client.executionPlan.findFirst({
        where: { shop, operationId },
        orderBy: { createdAt: "desc" },
        select: { id: true, planHash: true, planJson: true, status: true, mutationCount: true },
      }),
      client.immutableTargetSnapshotItem.findFirst({
        where: { shop, snapshotSet: { operationId } },
        orderBy: { ordinal: "asc" },
        select: { beforeFingerprint: true },
      }),
      client.immutableTargetSnapshotItem.count({
        where: { shop, snapshotSet: { operationId } },
      }),
      client.operationSubmission.findFirst({
        where: { shop, merchantOperationId: operationId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          bulkOperationId: true,
          payloadHash: true,
          submissionFingerprint: true,
        },
      }),
      client.verificationResult.findFirst({
        where: { shop, operationId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          verified: true,
          expectedFingerprint: true,
          actualFingerprint: true,
          mismatchReason: true,
        },
      }),
      client.undoRequest.findFirst({
        where: { shop, executionId: operationId },
        select: { id: true, status: true },
      }),
    ]);

  const undoPlan = undoRequest
    ? await client.undoExecutionPlan.findFirst({
        where: { shop, undoRequestId: undoRequest.id },
        select: { id: true, status: true, planHash: true, mutationCount: true },
      })
    : null;

  const intent = Array.isArray(operation.bulkEditIntents)
    ? operation.bulkEditIntents[0]
    : null;

  return buildOperationSpine({
    shop,
    operationId,
    mirrorBatch: intent?.mirrorBatchId
      ? {
          id: intent.mirrorBatchId,
          hash: intent.mirrorBatchId,
          status: "ACTIVE_OR_RECORDED",
        }
      : snapshotSet?.mirrorBatchId
        ? {
            id: snapshotSet.mirrorBatchId,
            hash: snapshotSet.mirrorBatchId,
            status: "RECORDED",
          }
        : null,
    canonicalFilterAst: intent
      ? {
          id: intent.id,
          hash: intent.canonicalFilterHash || intent.intentHash,
          metadata: { ast: intent.filterAst },
        }
      : snapshotSet?.filterHash
        ? { hash: snapshotSet.filterHash }
        : null,
    targetSnapshotSet: snapshotSet
      ? {
          id: snapshotSet.id,
          hash: snapshotSet.targetHash,
          count: Number(snapshotSet.productCount || 0) + Number(snapshotSet.variantCount || 0),
        }
      : null,
    executionPlan: executionPlan
      ? {
          id: executionPlan.id,
          hash: executionPlan.planHash,
          count: executionPlan.mutationCount,
          status: executionPlan.status,
        }
      : null,
    beforeValueSnapshot:
      beforeCount > 0
        ? {
            id: snapshotSet?.id || null,
            hash: beforeSample?.beforeFingerprint || snapshotSet?.targetHash,
            count: beforeCount,
          }
        : null,
    shopifyBulkMutation: submission
      ? {
          id: submission.bulkOperationId || submission.id,
          hash: submission.payloadHash || submission.submissionFingerprint,
          status: submission.status,
        }
      : executionPlan?.planJson?.preparedMutationArtifact?.prepared
        ? {
            id: executionPlan.planJson.preparedMutationArtifact.artifactId,
            hash: executionPlan.planJson.preparedMutationArtifact.checksum,
            count: executionPlan.planJson.preparedMutationArtifact.rowCount,
            status: "PREPARED",
            metadata: {
              path: executionPlan.planJson.preparedMutationArtifact.path,
              format: executionPlan.planJson.preparedMutationArtifact.format,
            },
          }
      : null,
    verificationSnapshot: verification
      ? {
          id: verification.id,
          hash: verification.actualFingerprint || verification.expectedFingerprint,
          status: verification.verified ? "VERIFIED" : "MISMATCH",
          metadata: { mismatchReason: verification.mismatchReason || null },
        }
      : null,
    undoPlan: undoPlan
      ? {
          id: undoPlan.id,
          hash: undoPlan.planHash,
          count: undoPlan.mutationCount,
          status: undoPlan.status,
        }
      : null,
  });
}
