import { prisma } from "../../config/database.js";
import { runAutomationRule } from "./automationRunService.js";

export async function triggerAutomations({
  shop,
  triggerType,
  mirrorBatchId,
  triggerReason,
}) {
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

  for (const rule of rules) {
    try {
      const result = await runAutomationRule({
        shop,
        automationRuleId: rule.id,
        mirrorBatchId,
        triggerReason,
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
      });
    }
  }

  return results;
}
