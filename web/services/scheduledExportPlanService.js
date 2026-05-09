import { prisma } from "../config/database.js";
import { scheduledExportRepository } from "../repositories/scheduledExportRepository.js";

const SCHEDULED_EXPORT_PLAN_KEYS = new Set([
  "ADVANCED_MONTHLY",
  "PRO_MONTHLY",
]);
const MAX_ACTIVE_SCHEDULED_EXPORTS = 10;

export function hasScheduledExportAccess(subscription = {}) {
  return (
    subscription?.isCreditUser === true ||
    (SCHEDULED_EXPORT_PLAN_KEYS.has(subscription?.planKey) &&
      subscription?.status === "ACTIVE")
  );
}

export async function assertScheduledExportAccess(subscription = {}) {
  if (!hasScheduledExportAccess(subscription)) {
    const error = new Error("SCHEDULED_EXPORT_PLAN_UPGRADE_REQUIRED");
    error.code = "SCHEDULED_EXPORT_PLAN_UPGRADE_REQUIRED";
    error.statusCode = 403;
    throw error;
  }
}

export async function getScheduledExportPlanContext(shop) {
  const [store, subscription] = await Promise.all([
    prisma.store.findUnique({
      where: { shopUrl: shop },
      select: { isCreditAvailable: true },
    }),
    prisma.subscription.findFirst({
      where: { shop },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (store?.isCreditAvailable) {
    return {
      shop,
      planKey: "PRO_MONTHLY",
      status: "ACTIVE",
      isCreditUser: true,
    };
  }

  return {
    shop,
    planKey: subscription?.planKey || "FREE",
    status: subscription?.status || "FREE",
    isCreditUser: false,
  };
}

export async function assertScheduledExportActiveLimit({
  shop,
  excludeScheduledExportId = null,
}) {
  const activeCount = await scheduledExportRepository.countActiveByShop(
    shop,
    excludeScheduledExportId,
  );
  if (activeCount >= MAX_ACTIVE_SCHEDULED_EXPORTS) {
    const error = new Error(
      `Your store already has ${MAX_ACTIVE_SCHEDULED_EXPORTS} active scheduled exports. Pause or delete one before activating another.`,
    );
    error.code = "SCHEDULED_EXPORT_ACTIVE_LIMIT_REACHED";
    error.statusCode = 403;
    throw error;
  }
}

export { MAX_ACTIVE_SCHEDULED_EXPORTS };
