import { prisma } from "../config/database.js";

const PRO_PLAN_KEYS = new Set(["PRO_MONTHLY"]);
export const MAX_ACTIVE_AUTOMATIC_PRODUCT_RULES = 20;

export function hasAutomaticProductRuleAccess(subscription = {}) {
  return (
    subscription?.isCreditUser === true ||
    (PRO_PLAN_KEYS.has(subscription?.planKey) && subscription?.status === "ACTIVE")
  );
}

export async function assertAutomaticProductRuleAccess(subscription = {}) {
  if (!hasAutomaticProductRuleAccess(subscription)) {
    throw new Error(
      "Automatic product rules are available only on the Pro plan. Please upgrade to continue.",
    );
  }
}

export async function getSubscriptionForShop(shop) {
  const store = await prisma.store.findUnique({
    where: { shopUrl: shop },
    select: { isCreditAvailable: true },
  });

  if (store?.isCreditAvailable) {
    return {
      shop,
      planKey: "PRO_MONTHLY",
      planName: "Pro Plan (Grandfathered)",
      isCreditUser: true,
      isUnlimited: true,
      limit: Number.MAX_SAFE_INTEGER,
      status: "ACTIVE",
    };
  }

  const subscription = await prisma.subscription.findFirst({
    where: { shop },
  });

  const planKey = subscription?.planKey || "FREE";
  const isPro = subscription?.status === "ACTIVE" && PRO_PLAN_KEYS.has(planKey);

  return {
    shop,
    planKey,
    planName: subscription?.planName || "Free Plan",
    isCreditUser: false,
    isUnlimited: isPro,
    limit: isPro ? Number.MAX_SAFE_INTEGER : 100,
    status: subscription?.status || "FREE",
  };
}

export async function assertAutomaticProductRuleActiveLimit({
  shop,
  repository,
  excludeAutomaticProductRuleId = null,
}) {
  const activeCount = await repository.countActiveByShop(shop, excludeAutomaticProductRuleId);

  if (activeCount >= MAX_ACTIVE_AUTOMATIC_PRODUCT_RULES) {
    throw new Error(
      `Your store already has ${MAX_ACTIVE_AUTOMATIC_PRODUCT_RULES} active automatic rules. Pause or cancel one before activating another.`,
    );
  }
}
