import { prisma } from "../../config/database.js";

export async function createAutomationRule({
  shop,
  name,
  triggerType,
  triggerConfig,
  ruleAstJson,
  actionsJson,
  dryRunFirst = true,
  cooldownSeconds = 300,
  maxRunsPerDay = 24,
}) {
  if (!shop) throw new Error("SHOP_REQUIRED");
  if (!name) throw new Error("AUTOMATION_NAME_REQUIRED");
  if (!triggerType) throw new Error("TRIGGER_TYPE_REQUIRED");
  if (!ruleAstJson) throw new Error("RULE_AST_REQUIRED");
  if (!Array.isArray(actionsJson) || actionsJson.length === 0) {
    throw new Error("AUTOMATION_ACTIONS_REQUIRED");
  }
  for (const action of actionsJson) {
    if (action?.status === "DISABLED") continue;
    if (action?.type !== "BULK_EDIT") {
      throw new Error(`UNSUPPORTED_AUTOMATION_ACTION_TYPE:${action?.type}`);
    }
    if (!Number.isFinite(Number(action?.maxTargets)) || Number(action.maxTargets) <= 0) {
      throw new Error("AUTOMATION_MAX_TARGETS_REQUIRED");
    }
  }

  return prisma.automationRule.create({
    data: {
      shop,
      name,
      triggerType,
      triggerConfig: triggerConfig ?? {},
      ruleAstJson,
      actionsJson,
      dryRunFirst,
      cooldownSeconds,
      maxRunsPerDay,
      status: "DRAFT",
    },
  });
}

export async function activateAutomationRule({ shop, automationRuleId }) {
  return prisma.automationRule.updateMany({
    where: {
      id: automationRuleId,
      shop,
      status: {
        in: ["DRAFT", "PAUSED"],
      },
    },
    data: {
      status: "ACTIVE",
    },
  });
}
