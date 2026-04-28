import { recurringEditRepository } from "../repositories/recurringEditRepository.js";

const PRO_PLAN_KEYS = new Set(["PRO_MONTHLY"]);
const MAX_ACTIVE_RECURRING_EDITS = 10;

export function hasRecurringEditAccess(subscription = {}) {
  return (
    subscription?.isCreditUser === true ||
    PRO_PLAN_KEYS.has(subscription?.planKey)
  );
}

export async function assertProRecurringEditAccess(subscription = {}) {
  if (!hasRecurringEditAccess(subscription)) {
    throw new Error(
      "Recurring edits are available only on the Pro plan. Please upgrade to continue.",
    );
  }
}

export async function assertRecurringEditActiveLimit({
  shop,
  excludeRecurringEditId = null,
}) {
  const activeCount = await recurringEditRepository.countActiveByShop(
    shop,
    excludeRecurringEditId,
  );

  if (activeCount >= MAX_ACTIVE_RECURRING_EDITS) {
    throw new Error(
      `Your store already has ${MAX_ACTIVE_RECURRING_EDITS} active recurring edits. Pause or cancel one before activating another.`,
    );
  }
}

export { MAX_ACTIVE_RECURRING_EDITS };
