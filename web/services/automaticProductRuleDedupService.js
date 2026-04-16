import { prisma } from "../Config/database.js";
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

function getCatalogBatchIdFromWhere(where) {
  if (!where || typeof where !== "object") {
    return null;
  }

  if (typeof where.catalogBatchId === "string") {
    return where.catalogBatchId;
  }

  const clauses = Array.isArray(where.AND) ? where.AND : [];
  const match = clauses.find((clause) => typeof clause?.catalogBatchId === "string");
  return match?.catalogBatchId || null;
}

function filterVariantsByCatalogBatch(products, catalogBatchId) {
  if (!catalogBatchId) {
    return products;
  }

  return products.map((product) => ({
    ...product,
    variants: Array.isArray(product.variants)
      ? product.variants.filter((variant) => variant.catalogBatchId === catalogBatchId)
      : product.variants,
  }));
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
  const catalogBatchId = getCatalogBatchIdFromWhere(finalWhere);
  const batchSize = Math.min(rule.maxAffectedPerRun || 250, 250);
  let cursorId = null;
  let hasMore = true;

  while (hasMore) {
    const fetchedProducts = await prisma.product.findMany({
      where: buildBaseWhere(finalWhere, cursorId),
      ...(include ? { include } : {}),
      orderBy: { id: "asc" },
      take: batchSize,
    });
    const products = include?.variants
      ? filterVariantsByCatalogBatch(fetchedProducts, catalogBatchId)
      : fetchedProducts;

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
  if (!matchedStateUpdates.length) return;
  await automaticProductRuleStateRepository.upsertManyStates(
    rule.id,
    rule.shop,
    matchedStateUpdates.map((u) => ({
      productId: u.productId,
      lastMatchedAt: u.lastMatchedAt,
    })),
  );
}

export async function persistAppliedStateUpdates(rule, appliedStateUpdates = []) {
  if (!appliedStateUpdates.length) return;
  await automaticProductRuleStateRepository.upsertManyStates(
    rule.id,
    rule.shop,
    appliedStateUpdates.map((u) => ({
      productId: u.productId,
      lastMatchedAt: u.lastMatchedAt,
      lastAppliedAt: u.lastAppliedAt,
      lastFingerprint: u.lastFingerprint,
      suppressedUntil: u.suppressedUntil,
    })),
  );
}
