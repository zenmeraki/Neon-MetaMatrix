import { prisma } from "../config/database.js";

const SCHEDULED_EXPORT_PLAN_KEYS = new Set([
  "ADVANCED_MONTHLY",
  "PRO_MONTHLY",
]);

export function hasScheduledExportAccess(subscription = {}) {
  return (
    subscription?.isCreditUser === true ||
    (SCHEDULED_EXPORT_PLAN_KEYS.has(subscription?.planKey) &&
      subscription?.status === "ACTIVE")
  );
}

export async function assertScheduledExportAccess(subscription = {}) {
  if (!hasScheduledExportAccess(subscription)) {
    throw new Error(
      "Scheduled exports are available only on Advanced and Pro plans.",
    );
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
