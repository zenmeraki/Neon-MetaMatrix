import { prisma } from "../../config/database.js";
import { runAutomationRule } from "./automationRunService.js";
import {
  assertShadowExternalCallsAllowed,
  assertShadowWriteAllowed,
} from "../shadowReadOnlyGuardService.js";

export async function triggerAutomations({
  shop,
  triggerType,
  mirrorBatchId,
  triggerReason = null,
  triggerReference = null,
  workerJobId = null,
  attempt = null,
  executionContext = null,
}) {
  const store = await prisma.store.findUnique({
    where: { shopUrl: shop },
    select: { activeMirrorBatchId: true },
  });

  if (!store?.activeMirrorBatchId || store.activeMirrorBatchId !== mirrorBatchId) {
    const error = new Error("AUTOMATION_MIRROR_BATCH_NOT_ACTIVE");
    error.code = "AUTOMATION_MIRROR_BATCH_NOT_ACTIVE";
    throw error;
  }

  const rules = await prisma.automationRule.findMany({
    where: {
      shop,
      status: "ACTIVE",
      triggerType,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const results = [];

  assertShadowExternalCallsAllowed(
    executionContext,
    "automation_trigger_service.run_automation_rule",
  );
  assertShadowWriteAllowed(
    executionContext,
    "automation_trigger_service.run_automation_rule",
  );

  for (const rule of rules) {
    try {
      const result = await runAutomationRule({
        shop,
        automationRuleId: rule.id,
        mirrorBatchId,
        triggerReason,
        triggerType,
        triggerReference,
        workerJobId,
        attempt,
      });

      results.push({
        automationRuleId: rule.id,
        success: true,
        result,
      });
    } catch (error) {
      results.push({
        automationRuleId: rule.id,
        success: false,
        error: error.message,
        code: error?.code || null,
        retryClass:
          String(error?.code || "").toUpperCase() === "SHADOW_APPROVAL_REQUIRED_OR_STALE"
            ? "requires_reapproval"
            : null,
      });
    }
  }

  return results;
}
