import { prisma } from "../../config/database.js";
import { stableHash } from "../../utils/idempotencyKey.js";

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

function shadowApprovalError(code, message, details = null) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = 409;
  error.retryClass = "requires_reapproval";
  error.details = details;
  return error;
}

export async function buildRunFingerprints({ shop, mirrorBatchId, executionPlanIds, snapshotSetIds }) {
  const normalizedExecutionPlanIds = normalizeStringArray(executionPlanIds);
  const normalizedSnapshotSetIds = normalizeStringArray(snapshotSetIds);

  const [plans, snapshots] = await Promise.all([
    normalizedExecutionPlanIds.length
      ? prisma.executionPlan.findMany({
          where: {
            shop,
            id: { in: normalizedExecutionPlanIds },
          },
          select: {
            id: true,
            planHash: true,
            snapshotSetId: true,
            mirrorBatchId: true,
            mutationCount: true,
          },
        })
      : Promise.resolve([]),
    normalizedSnapshotSetIds.length
      ? prisma.targetSnapshotSet.findMany({
          where: {
            shop,
            id: { in: normalizedSnapshotSetIds },
          },
          select: {
            id: true,
            mirrorBatchId: true,
            targetCount: true,
            status: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const sortedPlanPayload = plans
    .map((plan) => ({
      id: plan.id,
      planHash: plan.planHash,
      snapshotSetId: plan.snapshotSetId,
      mirrorBatchId: plan.mirrorBatchId,
      mutationCount: Number(plan.mutationCount || 0),
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));

  const sortedSnapshotPayload = snapshots
    .map((snapshot) => ({
      id: snapshot.id,
      mirrorBatchId: snapshot.mirrorBatchId,
      targetCount: Number(snapshot.targetCount || 0),
      status: snapshot.status,
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));

  const executionFingerprint = stableHash({
    schema: "automation.shadow.execution.v1",
    shop,
    mirrorBatchId: mirrorBatchId || null,
    executionPlans: sortedPlanPayload,
  });

  const snapshotFingerprint = stableHash({
    schema: "automation.shadow.snapshot.v1",
    shop,
    mirrorBatchId: mirrorBatchId || null,
    snapshots: sortedSnapshotPayload,
  });

  return {
    executionFingerprint,
    snapshotFingerprint,
    mirrorBatchId: mirrorBatchId || null,
  };
}

export function readShadowApproval(rule) {
  const config = rule?.triggerConfig && typeof rule.triggerConfig === "object"
    ? rule.triggerConfig
    : {};
  const approval = config?.shadowApproval && typeof config.shadowApproval === "object"
    ? config.shadowApproval
    : null;
  return approval;
}

export async function saveShadowApproval({
  shop,
  automationRuleId,
  approval,
}) {
  const rule = await prisma.automationRule.findFirstOrThrow({
    where: { id: automationRuleId, shop },
    select: { triggerConfig: true },
  });
  const nextTriggerConfig =
    rule?.triggerConfig && typeof rule.triggerConfig === "object"
      ? { ...rule.triggerConfig }
      : {};
  nextTriggerConfig.shadowApproval = approval;

  await prisma.automationRule.update({
    where: { id: automationRuleId },
    data: { triggerConfig: nextTriggerConfig },
  });
}

export function verifyShadowApproval({
  approval,
  currentExecutionFingerprint,
  currentSnapshotFingerprint,
  currentMirrorBatchId,
}) {
  if (!approval) {
    throw shadowApprovalError(
      "SHADOW_APPROVAL_REQUIRED_OR_STALE",
      "No active shadow approval found for this automation.",
    );
  }

  const matches =
    String(approval.executionFingerprint || "") === String(currentExecutionFingerprint || "") &&
    String(approval.snapshotFingerprint || "") === String(currentSnapshotFingerprint || "") &&
    String(approval.mirrorBatchId || "") === String(currentMirrorBatchId || "");

  if (!matches) {
    throw shadowApprovalError(
      "SHADOW_APPROVAL_REQUIRED_OR_STALE",
      "Shadow approval is stale. Re-run shadow mode and approve again.",
      {
        expected: {
          executionFingerprint: approval.executionFingerprint || null,
          snapshotFingerprint: approval.snapshotFingerprint || null,
          mirrorBatchId: approval.mirrorBatchId || null,
        },
        actual: {
          executionFingerprint: currentExecutionFingerprint || null,
          snapshotFingerprint: currentSnapshotFingerprint || null,
          mirrorBatchId: currentMirrorBatchId || null,
        },
      },
    );
  }
}

