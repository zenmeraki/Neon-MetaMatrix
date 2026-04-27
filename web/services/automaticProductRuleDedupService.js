import { prisma } from "../config/database.js";
import { automaticProductRuleStateRepository } from "../repositories/automaticProductRuleStateRepository.js";
import { buildAutomaticRuleFingerprint } from "../utils/automaticRuleFingerprintUtils.js";

function normalizeTriggerReference(triggerReference) {
  if (!triggerReference) return {};

  try {
    return JSON.parse(triggerReference);
  } catch (_error) {
    return { reference: String(triggerReference) };
  }
}

function buildProductInclude(actions = []) {
  const needsVariants = actions.some((action) =>
    [
      "price",
      "barcode",
      "sku",
      "inventory",
      "taxable",
      "compareAtPrice",
      "option1Values",
      "option2Values",
      "option3Values",
      "inventoryPolicy",
      "cost",
      "weight",
      "weightUnit",
    ].includes(action?.field),
  );

  return needsVariants ? { variants: true } : undefined;
}

function buildBaseWhere(where, cursorId) {
  const clauses = Array.isArray(where?.AND) ? [...where.AND] : [];
  if (cursorId) {
    clauses.push({
      id: {
        gt: cursorId,
      },
    });
  }

  return {
    ...where,
    ...(clauses.length ? { AND: clauses } : {}),
  };
}

export async function evaluateAutomaticRuleCandidates({ rule, run, where }) {
  const triggerMetadata = normalizeTriggerReference(run.triggerReference);
  const restrictedProductIds = Array.isArray(triggerMetadata.productIds)
    ? triggerMetadata.productIds.filter(Boolean)
    : [];

  const finalWhere = {
    ...where,
    ...(restrictedProductIds.length ? { id: { in: restrictedProductIds } } : {}),
  };

  const matchedCount = await prisma.product.count({ where: finalWhere });
  const now = new Date();
  const candidateProducts = [];
  const matchedStateUpdates = [];
  const appliedStateUpdates = [];
  const include = buildProductInclude(rule.actions);
  const batchSize = Math.min(rule.maxAffectedPerRun || 250, 250);
  let cursorId = null;
  let hasMore = true;

  while (hasMore) {
    const products = await prisma.product.findMany({
      where: buildBaseWhere(finalWhere, cursorId),
      ...(include ? { include } : {}),
      orderBy: { id: "asc" },
      take: batchSize,
    });

    if (!products.length) {
      break;
    }

    cursorId = products[products.length - 1].id;
    hasMore = products.length === batchSize;

    const states = await automaticProductRuleStateRepository.findByRuleAndProductIds(
      rule.id,
      rule.shop,
      products.map((product) => product.id),
    );

    const stateByProductId = states.reduce((accumulator, state) => {
      accumulator[state.productId] = state;
      return accumulator;
    }, {});

    for (const product of products) {
      const currentState = stateByProductId[product.id] || null;
      const fingerprint = buildAutomaticRuleFingerprint({
        product,
        actions: rule.actions,
        applyMode: rule.applyMode,
      });

      matchedStateUpdates.push({
        productId: product.id,
        lastMatchedAt: now,
      });

      if (currentState?.suppressedUntil && new Date(currentState.suppressedUntil) > now) {
        continue;
      }

      if (currentState?.lastFingerprint && currentState.lastFingerprint === fingerprint) {
        continue;
      }

      if (rule.cooldownMinutes && currentState?.lastAppliedAt) {
        const cooldownUntil = new Date(currentState.lastAppliedAt);
        cooldownUntil.setMinutes(cooldownUntil.getMinutes() + rule.cooldownMinutes);
        if (cooldownUntil > now) {
          continue;
        }
      }

      candidateProducts.push(product);
      appliedStateUpdates.push({
        productId: product.id,
        lastMatchedAt: now,
        lastFingerprint: fingerprint,
        lastAppliedAt: now,
        suppressedUntil: rule.cooldownMinutes
          ? new Date(now.getTime() + rule.cooldownMinutes * 60_000)
          : null,
      });

      if (rule.maxAffectedPerRun && candidateProducts.length >= rule.maxAffectedPerRun) {
        hasMore = false;
        break;
      }
    }

    if (restrictedProductIds.length) {
      hasMore = false;
    }
  }

  return {
    matchedCount,
    candidateProducts,
    matchedStateUpdates,
    appliedStateUpdates,
  };
}

export async function persistMatchedStateUpdates(rule, matchedStateUpdates = []) {
  for (const update of matchedStateUpdates) {
    await automaticProductRuleStateRepository.upsertState({
      automaticProductRuleId: rule.id,
      shop: rule.shop,
      productId: update.productId,
      data: {
        lastMatchedAt: update.lastMatchedAt,
      },
    });
  }
}

export async function persistAppliedStateUpdates(rule, appliedStateUpdates = []) {
  for (const update of appliedStateUpdates) {
    await automaticProductRuleStateRepository.upsertState({
      automaticProductRuleId: rule.id,
      shop: rule.shop,
      productId: update.productId,
      data: {
        lastMatchedAt: update.lastMatchedAt,
        lastAppliedAt: update.lastAppliedAt,
        lastFingerprint: update.lastFingerprint,
        suppressedUntil: update.suppressedUntil,
      },
    });
  }
}
