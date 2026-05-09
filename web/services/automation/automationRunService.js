import { prisma } from "../../config/database.js";
import { assertAutomationCanRun } from "./automationGuardService.js";
import { compileAutomationActionToBulkEditIntent } from "./automationIntentCompiler.js";
import { createBulkEditIntent } from "../bulkIntent/bulkEditIntentService.js";
import { freezeTargetSnapshotSet } from "../bulkExecution/targetSnapshotService.js";
import { buildExecutionPlan } from "../bulkExecution/executionPlanService.js";
import { recordAuditEvent } from "../auditLogService.js";

export async function runAutomationRule({
  shop,
  automationRuleId,
  mirrorBatchId,
  triggerReason = "MANUAL",
}) {
  const rule = await prisma.automationRule.findFirstOrThrow({
    where: {
      id: automationRuleId,
      shop,
    },
  });

  await assertAutomationCanRun({ shop, rule });

  const run = await prisma.automationRun.create({
    data: {
      shop,
      automationRuleId: rule.id,
      status: "RUNNING",
      mirrorBatchId,
      triggerReason,
      startedAt: new Date(),
    },
  });

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
      });

      intentHashes.push(intentHash);
      snapshotSetIds.push(snapshot.snapshotSetId);
      executionPlanIds.push(executionPlan.executionPlanId);
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
      },
    });

    return {
      automationRunId: run.id,
      status: rule.dryRunFirst ? "PREVIEW_READY" : "READY_TO_EXECUTE",
      intentHashes,
      snapshotSetIds,
      executionPlanIds,
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
