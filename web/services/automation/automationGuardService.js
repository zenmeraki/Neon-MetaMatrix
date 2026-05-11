import { prisma } from "../../config/database.js";

export async function assertAutomationCanRun({ shop, rule }) {
  if (rule.status !== "ACTIVE") {
    throw new Error("AUTOMATION_NOT_ACTIVE");
  }

  if (rule.lastRunAt) {
    const elapsedSeconds =
      (Date.now() - new Date(rule.lastRunAt).getTime()) / 1000;

    if (elapsedSeconds < rule.cooldownSeconds) {
      throw new Error("AUTOMATION_COOLDOWN_ACTIVE");
    }
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const runsToday = await prisma.automationRun.count({
    where: {
      shop,
      automationRuleId: rule.id,
      createdAt: {
        gte: startOfDay,
      },
      status: {
        notIn: ["FAILED", "CANCELLED"],
      },
    },
  });

  if (runsToday >= rule.maxRunsPerDay) {
    throw new Error("AUTOMATION_DAILY_LIMIT_REACHED");
  }
}
