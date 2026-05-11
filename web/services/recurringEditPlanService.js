import { recurringEditRepository } from "../repositories/recurringEditRepository.js";
import { prisma } from "../config/database.js";
import { assertShopOperational } from "./shopOperationalGuardService.js";
import { recordMirrorAnomaly } from "./mirrorAnomalyService.js";

const RECURRING_EDIT_PLAN_KEYS = new Set([
  "PRO_MONTHLY",
  "PRO_ANNUAL",
  "ADVANCED_MONTHLY",
  "ADVANCED_ANNUAL",
  "ENTERPRISE",
]);
const DEFAULT_ACTIVE_RECURRING_EDITS = 10;
const PLAN_LIMITS = {
  PRO_MONTHLY: 10,
  PRO_ANNUAL: 10,
  ADVANCED_MONTHLY: 5,
  ADVANCED_ANNUAL: 5,
  ENTERPRISE: 100,
};
const ENTITLEMENT_CACHE_TTL_MS = Number(
  process.env.RECURRING_EDIT_ENTITLEMENT_CACHE_TTL_MS || 30_000,
);
const ENTITLEMENT_ACTIVE_STATUSES = new Set([
  "ACTIVE",
  "TRIALING",
  "GRANDFATHERED",
  "ENTERPRISE_ACTIVE",
]);
const entitlementCache = new Map();

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeSubscriptionStatus(status) {
  return String(status || "").trim().toUpperCase();
}

function hasActiveEntitlementStatus(subscription = {}) {
  return ENTITLEMENT_ACTIVE_STATUSES.has(
    normalizeSubscriptionStatus(subscription?.status),
  );
}

function getCachedEntitlement(shop) {
  const hit = entitlementCache.get(shop);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    entitlementCache.delete(shop);
    return null;
  }
  return hit.value;
}

function setCachedEntitlement(shop, value) {
  entitlementCache.set(shop, {
    value,
    expiresAt: Date.now() + ENTITLEMENT_CACHE_TTL_MS,
  });
}

export function hasRecurringEditAccess(subscription = {}) {
  const isActive = hasActiveEntitlementStatus(subscription);
  return (
    (subscription?.isCreditUser === true && isActive) ||
    (RECURRING_EDIT_PLAN_KEYS.has(subscription?.planKey) && isActive)
  );
}

export function assertProRecurringEditAccess(subscription = {}) {
  if (!hasRecurringEditAccess(subscription)) {
    throw codedError(
      "RECURRING_EDIT_PLAN_REQUIRED",
      "Recurring edits require an active eligible plan",
    );
  }
}

export async function assertProRecurringEditAccessForShop({ shop, tx = null }) {
  await assertShopOperational(shop);

  const db = tx || prisma;
  if (!tx) {
    const cached = getCachedEntitlement(shop);
    if (cached) {
      assertProRecurringEditAccess(cached);
      return cached;
    }
  }

  const subscription = await db.subscription.findUnique({
    where: { shop },
    select: {
      planKey: true,
      status: true,
      updatedAt: true,
    },
  });

  const normalized = {
    ...(subscription || {}),
    isCreditUser: false,
    status: normalizeSubscriptionStatus(subscription?.status),
  };
  try {
    assertProRecurringEditAccess(normalized);
  } catch (error) {
    await recordMirrorAnomaly({
      shop,
      severity: "medium",
      type: "recurring_edit_entitlement_denied",
      entityType: "recurring_edit",
      message: "Recurring edit access denied by entitlement policy",
      details: {
        planKey: normalized.planKey || null,
        status: normalized.status || null,
        code: error.code || error.message,
      },
    }).catch(() => {});
    throw error;
  }

  if (!tx) {
    setCachedEntitlement(shop, normalized);
  }
  return normalized;
}

export function getRecurringEditLimit(subscription = {}) {
  if (subscription?.isCreditUser === true && hasActiveEntitlementStatus(subscription)) {
    return DEFAULT_ACTIVE_RECURRING_EDITS;
  }

  if (!hasActiveEntitlementStatus(subscription)) return 0;
  return PLAN_LIMITS[subscription?.planKey] || 0;
}

export async function assertRecurringEditActiveLimit({
  shop,
  excludeRecurringEditId = null,
  tx = null,
  subscription = null,
}) {
  const limit = getRecurringEditLimit(subscription || {});
  if (limit <= 0) {
    throw codedError("RECURRING_EDIT_PLAN_REQUIRED");
  }

  const activeCount = await recurringEditRepository.countActiveByShop(
    shop,
    excludeRecurringEditId,
    tx || undefined,
  );

  if (activeCount >= limit) {
    throw codedError(
      "RECURRING_EDIT_ACTIVE_LIMIT_REACHED",
      `Active recurring edit limit reached (${limit})`,
    );
  }
}

export { DEFAULT_ACTIVE_RECURRING_EDITS as MAX_ACTIVE_RECURRING_EDITS };
