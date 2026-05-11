import { prisma } from "../../config/database.js";
import { assertAutomationCanRun } from "./automationGuardService.js";
import { compileAutomationActionToBulkEditIntent } from "./automationIntentCompiler.js";
import { createBulkEditIntent } from "../bulkIntent/bulkEditIntentService.js";
import { freezeTargetSnapshotSet } from "../bulkExecution/targetSnapshotService.js";
import { buildExecutionPlan } from "../bulkExecution/executionPlanService.js";
import { recordAuditEvent } from "../auditLogService.js";
import { merchantOperationRepository } from "../../repositories/merchantOperationRepository.js";
import { stableHash } from "../../utils/idempotencyKey.js";
import {
  buildRunFingerprints,
  readShadowApproval,
  verifyShadowApproval,
} from "./shadowApprovalService.js";

export async function runAutomationRule({
  shop,
  automationRuleId,
  mirrorBatchId,
  triggerReason = "MANUAL",
  triggerType = null,
  triggerReference = null,
  workerJobId = null,
  attempt = null,
}) {
  const rule = await prisma.automationRule.findFirstOrThrow({
    where: {
      id: automationRuleId,
      shop,
    },
  });

  await assertAutomationCanRun({ shop, rule });

  const executionKey = stableHash({
    type: "AUTOMATION_RULE_TRIGGER",
    shop,
    automationRuleId: rule.id,
    triggerType: triggerType || rule.triggerType || null,
    mirrorBatchId,
    triggerReference: triggerReference || null,
  });

  let run = await prisma.automationRun.upsert({
    where: {
      shop_automationRuleId_executionKey: {
        shop,
        automationRuleId: rule.id,
        executionKey,
      },
    },
    update: {},
    create: {
      shop,
      automationRuleId: rule.id,
      executionKey,
      triggerReference,
      workerJobId,
      attempt: Number.isInteger(attempt) ? attempt : null,
      status: "RUNNING",
      mirrorBatchId,
      triggerReason,
      startedAt: new Date(),
    },
  });

  if (
    !["CREATED", "RUNNING", "FAILED"].includes(run.status) ||
    (run.status === "RUNNING" && run.workerJobId && run.workerJobId !== workerJobId)
  ) {
    return {
      automationRunId: run.id,
      status: run.status,
      skipped: true,
      reason: "automation_run_already_claimed_or_completed",
      executionKey,
    };
  }

  const claimed = await prisma.automationRun.updateMany({
    where: {
      id: run.id,
      shop,
      automationRuleId: rule.id,
      executionKey,
      status: { in: ["CREATED", "RUNNING", "FAILED"] },
    },
    data: {
      status: "RUNNING",
      triggerReference,
      workerJobId,
      attempt: Number.isInteger(attempt) ? attempt : null,
      startedAt: run.startedAt || new Date(),
      errorCode: null,
      errorMessage: null,
    },
  });

  if (claimed.count !== 1) {
    return {
      automationRunId: run.id,
      status: run.status,
      skipped: true,
      reason: "automation_run_claim_lost",
      executionKey,
    };
  }

  run = await prisma.automationRun.findUnique({ where: { id: run.id } });

  const intentHashes = [];
  const snapshotSetIds = [];
  const executionPlanIds = [];
  let totalTargetCount = 0;

  try {
    await recordAuditEvent({
      shop,
      action: "AUTOMATION_RUN_STARTED",
      entityType: "AUTOMATION_RULE",
      entityId: rule.id,
      metadata: {
        automationRunId: run.id,
        triggerReason,
        mirrorBatchId,
        triggerReference,
        executionKey,
      },
    });

    for (const action of Array.isArray(rule.actionsJson) ? rule.actionsJson : []) {
      const rawIntent = compileAutomationActionToBulkEditIntent({
        shop,
        rule,
        action,
        mirrorBatchId,
      });

      if (!rawIntent) continue;

      const { intent, intentHash } = await createBulkEditIntent(rawIntent);
      const operation = await merchantOperationRepository.createPlannedOperationForEdit({
        shop,
        type: "BULK_EDIT",
        title: `Automation rule ${rule.id}`,
        source: "automation",
        idempotencyKey: `automation-run:${run.id}:${intentHash}`,
        totalItems: 0,
        startedAt: null,
      });

      const snapshot = await freezeTargetSnapshotSet({
        intent,
        intentHash,
      });
      totalTargetCount += Number(snapshot.targetCount || 0);
      const maxTargets = Number(rawIntent?.safety?.maxTargets);
      if (Number.isFinite(maxTargets) && maxTargets > 0 && snapshot.targetCount > maxTargets) {
        const error = new Error("AUTOMATION_TARGET_CAP_EXCEEDED");
        error.code = "AUTOMATION_TARGET_CAP_EXCEEDED";
        throw error;
      }

      const executionPlan = await buildExecutionPlan({
        intent,
        intentHash,
        snapshotSetId: snapshot.snapshotSetId,
        operationId: operation.id,
      });
      await merchantOperationRepository.transitionById(operation.id, shop, {
        snapshotSetId: snapshot.snapshotSetId,
        executionPlanId: executionPlan.executionPlanId,
        intentId: intentHash,
        targetHash: executionPlan.planHash,
        totalItems: Number(snapshot.targetCount || 0),
      });

      intentHashes.push(intentHash);
      snapshotSetIds.push(snapshot.snapshotSetId);
      executionPlanIds.push(executionPlan.executionPlanId);
    }

    if (!rule.dryRunFirst) {
      const currentFingerprints = await buildRunFingerprints({
        shop,
        mirrorBatchId,
        executionPlanIds,
        snapshotSetIds,
      });
      const activeApproval = readShadowApproval(rule);
      try {
        verifyShadowApproval({
          approval: activeApproval,
          currentExecutionFingerprint: currentFingerprints.executionFingerprint,
          currentSnapshotFingerprint: currentFingerprints.snapshotFingerprint,
          currentMirrorBatchId: currentFingerprints.mirrorBatchId,
        });
      } catch (error) {
        await recordAuditEvent({
          shop,
          action: "AUTOMATION_WRITE_BLOCKED_STALE_SHADOW_APPROVAL",
          entityType: "AUTOMATION_RULE",
          entityId: rule.id,
          metadata: {
            automationRunId: run.id,
            triggerReference,
            executionKey,
            retryClass: "requires_reapproval",
            approvedExecutionFingerprint: activeApproval?.executionFingerprint || null,
            approvedSnapshotFingerprint: activeApproval?.snapshotFingerprint || null,
            approvedMirrorBatchId: activeApproval?.mirrorBatchId || null,
            currentExecutionFingerprint: currentFingerprints.executionFingerprint,
            currentSnapshotFingerprint: currentFingerprints.snapshotFingerprint,
            currentMirrorBatchId: currentFingerprints.mirrorBatchId,
          },
        });
        throw error;
      }
    }

    await prisma.automationRun.update({
      where: { id: run.id },
      data: {
        status: rule.dryRunFirst ? "PREVIEW_READY" : "READY_TO_EXECUTE",
        intentHashesJson: intentHashes,
        snapshotSetIdsJson: snapshotSetIds,
        executionPlanIdsJson: executionPlanIds,
        actionCount: executionPlanIds.length,
        targetCount: totalTargetCount,
        completedAt: rule.dryRunFirst ? new Date() : null,
      },
    });

    await prisma.automationRule.update({
      where: { id: rule.id },
      data: {
        lastRunAt: new Date(),
      },
    });

    await recordAuditEvent({
      shop,
      action: "AUTOMATION_RUN_PREVIEW_READY",
      entityType: "AUTOMATION_RULE",
      entityId: rule.id,
      metadata: {
        automationRunId: run.id,
        intentCount: intentHashes.length,
        snapshotSetCount: snapshotSetIds.length,
        executionPlanCount: executionPlanIds.length,
        totalTargetCount,
        triggerReference,
        executionKey,
      },
    });

    return {
      automationRunId: run.id,
      status: rule.dryRunFirst ? "PREVIEW_READY" : "READY_TO_EXECUTE",
      intentHashes,
      snapshotSetIds,
      executionPlanIds,
      executionKey,
    };
  } catch (error) {
    await prisma.automationRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorCode: error.message,
        errorMessage: error.stack,
        completedAt: new Date(),
      },
    });
    await recordAuditEvent({
      shop,
      action: "AUTOMATION_RUN_FAILED",
      entityType: "AUTOMATION_RULE",
      entityId: rule.id,
      metadata: {
        automationRunId: run.id,
        errorCode: error?.code || error?.message || "UNKNOWN",
      },
    });

    throw error;
  }
}
