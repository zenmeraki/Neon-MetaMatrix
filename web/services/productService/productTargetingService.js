import { prisma } from "../../Config/database.js";
import { getActiveBatchIds } from "../sync/catalogSnapshotService.js";
import * as collectionMembershipRepository from "../../repositories/collectionMembershipRepository.js";
import * as inventoryLevelRepository from "../../repositories/inventoryLevelRepository.js";
import * as targetSnapshotService from "../execution/targetSnapshotService.js";
import {
  buildPrismaSortQuery,
  getProductPrismaWhere,
} from "./productFilterCompiler.js";
import { recordMirrorAnomaly } from "../mirrorAnomalyService.js";
import {
  buildCanonicalFilterKey,
  sha256Hex,
} from "../../utils/deterministicHashUtils.js";
import { logBatchEvent } from "../../utils/batchObservability.js";

const PRODUCT_QUERY_BATCH_FIELD = "catalogBatchId";

function mergeWithBatchScope(where, shop, catalogBatchId) {
  const scoped = {
    AND: [
      where && typeof where === "object" ? where : {},
      { shop },
      { catalogBatchId },
    ],
  };

  return scoped;
}

const COLLECTION_FILTER_OPERATORS = new Set([
  "equals",
  "is",
  "contains",
  "does not equal",
  "is not",
  "does not contain",
  "is empty",
  "is empty/blank",
  "is not empty",
]);

const INVENTORY_LOCATION_OPERATORS = new Set([
  ">",
  ">=",
  "<",
  "<=",
  "=",
  "!=",
  "greater than",
  "greater than or equal",
  "less than",
  "less than or equal",
  "equals",
  "is",
  "does not equal",
  "is not",
]);

const INVENTORY_LOCATION_NEGATIVE_OPERATORS = new Set([
  "!=",
  "does not equal",
  "is not",
]);

/**
 * Pulls inventory_at_location filters out of filterParams so they can be
 * resolved against VariantInventoryLevel rather than compiled into Prisma
 * variant sub-queries (which have no locationId dimension).
 */
const splitInventoryLocationFilters = (filterParams = []) => {
  const inventoryLocationFilters = [];
  const remainingFilters = [];

  for (const filter of Array.isArray(filterParams) ? filterParams : []) {
    if (
      filter?.field === "inventory_at_location" &&
      filter?.locationId &&
      INVENTORY_LOCATION_OPERATORS.has(filter?.operator)
    ) {
      inventoryLocationFilters.push(filter);
      continue;
    }

    remainingFilters.push(filter);
  }

  return { inventoryLocationFilters, remainingFilters };
};

const resolveInventoryLocationFilterWhere = async ({
  shop,
  catalogBatchId,
  inventoryLocationFilters,
}) => {
  const clauses = [];

  for (const filter of inventoryLocationFilters) {
    const productIds = await inventoryLevelRepository.findProductIdsByInventoryLocation({
      shop,
      catalogBatchId,
      locationId: filter.locationId,
      operator: filter.operator,
      available: Number(filter.value ?? 0),
    });

    const mode = INVENTORY_LOCATION_NEGATIVE_OPERATORS.has(filter.operator) ? "notIn" : "in";
    clauses.push(buildProductIdFilter(productIds, mode));
  }

  return clauses.filter((clause) => Object.keys(clause).length > 0);
};

const splitCollectionFilters = (filterParams = []) => {
  const collectionFilters = [];
  const remainingFilters = [];

  for (const filter of Array.isArray(filterParams) ? filterParams : []) {
    if (
      filter?.field === "collection" &&
      COLLECTION_FILTER_OPERATORS.has(filter?.operator)
    ) {
      collectionFilters.push(filter);
      continue;
    }

    remainingFilters.push(filter);
  }

  return {
    collectionFilters,
    remainingFilters,
  };
};

const buildProductIdFilter = (ids, mode) => {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));

  if (mode === "in") {
    return { id: { in: uniqueIds } };
  }

  if (uniqueIds.length === 0) {
    return {};
  }

  return { id: { notIn: uniqueIds } };
};

const resolveCollectionFilterWhere = async ({
  shop,
  catalogBatchId,
  collectionFilters,
}) => {
  const clauses = [];

  for (const filter of collectionFilters) {
    const operator = filter.operator;

    if (operator === "is empty" || operator === "is empty/blank") {
      const productIds =
        await collectionMembershipRepository.findProductIdsWithAnyCollection({
          shop,
          catalogBatchId,
        });
      clauses.push(buildProductIdFilter(productIds, "notIn"));
      continue;
    }

    if (operator === "is not empty") {
      const productIds =
        await collectionMembershipRepository.findProductIdsWithAnyCollection({
          shop,
          catalogBatchId,
        });
      clauses.push(buildProductIdFilter(productIds, "in"));
      continue;
    }

    const productIds =
      await collectionMembershipRepository.findProductIdsByCollectionTitle({
        shop,
        catalogBatchId,
        title: filter.value,
        operator,
      });

    if (
      operator === "does not equal" ||
      operator === "is not" ||
      operator === "does not contain"
    ) {
      clauses.push(buildProductIdFilter(productIds, "notIn"));
      continue;
    }

    clauses.push(buildProductIdFilter(productIds, "in"));
  }

  return clauses.filter((clause) => Object.keys(clause).length > 0);
};

export async function getActiveProductCatalogBatchId(shop) {
  const activeBatch = await getActiveBatchIds({
    shop,
    path: "preview",
  });
  return activeBatch.catalogBatchId;
}

export async function resolveProductReadBatchScope({
  shop,
  path = "preview",
  snapshot = null,
}) {
  const resolvedBatch = snapshot?.catalogBatchId
    ? {
        shop,
        catalogBatchId: snapshot.catalogBatchId,
        snapshotId: snapshot.snapshotId || snapshot.id || null,
        catalogSnapshotId:
          snapshot.catalogSnapshotId || snapshot.snapshotId || snapshot.id || null,
        productBatchId: snapshot.productBatchId || snapshot.catalogBatchId,
        variantBatchId: snapshot.variantBatchId || snapshot.catalogBatchId,
        collectionBatchId: snapshot.collectionBatchId || snapshot.catalogBatchId,
        inventoryBatchId: snapshot.inventoryBatchId || snapshot.catalogBatchId,
        isConsistent: snapshot.isConsistent === true,
        consistencyCheckedAt: snapshot.consistencyCheckedAt || null,
        activatedAt: snapshot.activatedAt || null,
        consistencyReason: snapshot.consistencyReason || snapshot.reason || null,
      }
    : await getActiveBatchIds({ shop, path });

  return {
    shop,
    catalogBatchId: resolvedBatch.catalogBatchId,
    mirrorBatchId: resolvedBatch.catalogBatchId,
    batchId: resolvedBatch.catalogBatchId,
    batchField: PRODUCT_QUERY_BATCH_FIELD,
    snapshotId: resolvedBatch.snapshotId || null,
    catalogSnapshotId:
      resolvedBatch.catalogSnapshotId || resolvedBatch.snapshotId || null,
    productBatchId: resolvedBatch.productBatchId || resolvedBatch.catalogBatchId,
    variantBatchId: resolvedBatch.variantBatchId || resolvedBatch.catalogBatchId,
    collectionBatchId:
      resolvedBatch.collectionBatchId || resolvedBatch.catalogBatchId,
    inventoryBatchId: resolvedBatch.inventoryBatchId || resolvedBatch.catalogBatchId,
    isConsistent: resolvedBatch.isConsistent === true,
    consistencyCheckedAt: resolvedBatch.consistencyCheckedAt || null,
    activatedAt: resolvedBatch.activatedAt || null,
    consistencyReason: resolvedBatch.consistencyReason || null,
    cutoverFlag: null,
    cutoverEnabled: true,
  };
}

export async function resolveCanonicalProductTarget({
  shop,
  filterParams = [],
  queryParams = {},
  explicitWhere = null,
  explicitProductIds = [],
  sampleLimit = 20,
  freeze = false,
  ownerType = null,
  ownerId = null,
  filterVersion = 1,
  path = "preview",
  snapshot = null,
}) {
  const batchScope = await resolveProductReadBatchScope({ shop, path, snapshot });
  logBatchEvent("catalog_batch_filter", {
    shop,
    oldMirrorBatchId: null,
    resolvedCatalogBatchId: batchScope.catalogBatchId,
    path,
    extra: {
      ownerType,
      ownerId,
      filterVersion,
      batchField: batchScope.batchField,
      cutoverFlag: batchScope.cutoverFlag,
      cutoverEnabled: batchScope.cutoverEnabled,
      explicitProductCount: Array.isArray(explicitProductIds)
        ? explicitProductIds.length
        : 0,
    },
  });

  const { inventoryLocationFilters, remainingFilters: filtersAfterInventory } =
    splitInventoryLocationFilters(filterParams);
  const { collectionFilters, remainingFilters } =
    splitCollectionFilters(filtersAfterInventory);
  const baseWhere =
    explicitWhere || getProductPrismaWhere(remainingFilters, shop, batchScope.catalogBatchId);
  const where = mergeWithBatchScope(
    baseWhere,
    shop,
    batchScope.catalogBatchId,
  );
  const canonicalFilterKey = buildCanonicalFilterKey({
    shop,
    mirrorBatchId: batchScope.catalogBatchId,
    filterParams,
    explicitProductIds,
    queryWhere: explicitWhere,
    filterVersion,
  });
  let compiledWhereHash = null;

  if (batchScope.batchId && collectionFilters.length > 0) {
    const collectionClauses = await resolveCollectionFilterWhere({
      shop,
      catalogBatchId: batchScope.catalogBatchId,
      collectionFilters,
    });

    where.AND.push(...collectionClauses);
  }

  if (batchScope.batchId && inventoryLocationFilters.length > 0) {
    const inventoryClauses = await resolveInventoryLocationFilterWhere({
      shop,
      catalogBatchId: batchScope.catalogBatchId,
      inventoryLocationFilters,
    });

    where.AND.push(...inventoryClauses);
  }

  if (Array.isArray(explicitProductIds) && explicitProductIds.length > 0) {
    where.AND.push({
      id: {
        in: explicitProductIds,
      },
    });
  }

  compiledWhereHash = sha256Hex(where);

  const orderBy = buildPrismaSortQuery(queryParams.sortKey, queryParams.sortOrder);
  const page = Number.parseInt(queryParams.page, 10) || 1;
  const limit = Number.parseInt(queryParams.limit, 10) || sampleLimit;
  const skip = (page - 1) * limit;

  const [count, sampleProducts] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      select: {
        id: true,
        title: true,
        status: true,
        productType: true,
        vendor: true,
        totalInventory: true,
        featuredImageUrl: true,
        categoryName: true,
        handle: true,
        templateSuffix: true,
        variantCount: true,
        visibleOnlineStore: true,
      },
      orderBy,
      skip,
      take: Math.min(limit, sampleLimit),
    }),
  ]);

  if (freeze && ownerType && ownerId) {
    await freezeTargetSnapshot({
      ownerType,
      ownerId,
      shop,
      where,
      catalogBatchId: batchScope.catalogBatchId,
      batchField: batchScope.batchField,
      filterVersion,
      canonicalFilterKey,
      compiledWhereHash,
      path,
    });
  }

  return {
    catalogBatchId: batchScope.catalogBatchId,
    mirrorBatchId: batchScope.catalogBatchId,
    snapshotId: batchScope.snapshotId,
    batchScope: {
      catalogSnapshotId: batchScope.catalogSnapshotId,
      productBatchId: batchScope.productBatchId,
      variantBatchId: batchScope.variantBatchId,
      collectionBatchId: batchScope.collectionBatchId,
      inventoryBatchId: batchScope.inventoryBatchId,
      isConsistent: batchScope.isConsistent,
      consistencyCheckedAt: batchScope.consistencyCheckedAt,
      activatedAt: batchScope.activatedAt,
      consistencyReason: batchScope.consistencyReason,
    },
    batchField: batchScope.batchField,
    cutoverFlag: batchScope.cutoverFlag,
    cutoverEnabled: batchScope.cutoverEnabled,
    where,
    filterVersion,
    canonicalFilterKey,
    compiledWhereHash,
    count,
    totalCount: count,
    sampleProducts,
    pagination: {
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
      hasNextPage: skip + limit < count,
      hasPrevPage: page > 1,
    },
  };
}

export async function freezeTargetSnapshot({
  ownerType,
  ownerId,
  shop,
  where,
  catalogBatchId = null,
  mirrorBatchId,
  batchField = PRODUCT_QUERY_BATCH_FIELD,
  targetLevel = "PRODUCT",
  filterVersion = 1,
  canonicalFilterKey = null,
  compiledWhereHash = null,
  rulesHash = null,
  ruleEngineVersion = "product-set-v1",
  filterAnchorTime = new Date(),
  path = "execute",
  client = prisma,
  executionBatchSize = 75,
}) {
  const normalizedTargetLevel = targetLevel === "VARIANT" ? "VARIANT" : "PRODUCT";
  const resolvedCatalogBatchId = catalogBatchId || mirrorBatchId || null;
  logBatchEvent("catalog_batch_filter", {
    shop,
    oldMirrorBatchId: null,
    resolvedCatalogBatchId,
    path,
    extra: {
      ownerType,
      ownerId,
      targetLevel: normalizedTargetLevel,
      filterVersion,
      batchField,
    },
  });

  const resolvedCompiledWhereHash = compiledWhereHash || sha256Hex(where || {});
  const targetSnapshotSet =
    await targetSnapshotService.createBuildingTargetSnapshotSet({
      shop,
      ownerType,
      ownerId,
      catalogBatchId: resolvedCatalogBatchId,
      mirrorBatchId: resolvedCatalogBatchId,
      sourceType: "FILTER",
      reason: "target freeze",
      targetLevel: normalizedTargetLevel,
      filterVersion,
      canonicalFilterKey,
      compiledWhereHash: resolvedCompiledWhereHash,
      rulesHash,
      ruleEngineVersion,
      filterAnchorTime,
      client,
    });

  const BATCH_SIZE = 1000;
  const normalizedExecutionBatchSize =
    Number.isInteger(executionBatchSize) && executionBatchSize > 0
      ? executionBatchSize
      : 75;
  let cursorId = null;
  let totalInserted = 0;

  while (true) {
    const snapshotWhere = {
      AND: [
        ...(Array.isArray(where?.AND) ? where.AND : [where]),
        ...(cursorId ? [{ id: { gt: cursorId } }] : []),
      ],
    };

    const products = await client.product.findMany({
      where: snapshotWhere,
      select: {
        id: true,
        ...(normalizedTargetLevel === "VARIANT"
          ? {
              variants: {
                select: { id: true },
                orderBy: { id: "asc" },
              },
            }
          : {}),
      },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });

    if (!products.length) {
      break;
    }

    const targetItems = normalizedTargetLevel === "VARIANT"
      ? products.flatMap((product) =>
          (product.variants || []).map((variant) => ({
            productId: product.id,
            variantId: variant.id,
            targetKey: `variant:${variant.id}`,
            catalogBatchId: resolvedCatalogBatchId,
          })),
        )
      : products.map((product) => ({
          productId: product.id,
          targetKey: `product:${product.id}`,
          catalogBatchId: resolvedCatalogBatchId,
        }));
    const orderedTargetItems = targetItems.sort((left, right) =>
      left.targetKey.localeCompare(right.targetKey),
    );
    const sequencedTargetItems = orderedTargetItems.map((item, index) => ({
      ...item,
      batchSequenceNumber:
        Math.floor((totalInserted + index) / normalizedExecutionBatchSize) + 1,
    }));

    await targetSnapshotService.appendTargetSnapshotItems({
      targetSnapshotSetId: targetSnapshotSet.id,
      shop,
      catalogBatchId: resolvedCatalogBatchId,
      items: sequencedTargetItems,
      client,
    });

    totalInserted += sequencedTargetItems.length;
    cursorId = products[products.length - 1].id;
  }

  if (totalInserted > 0) {
    await client.$executeRaw`
      UPDATE "TargetSnapshotItem" AS item
      SET "batchSequenceNumber" = ranked."batchSequenceNumber"
      FROM (
        SELECT
          id,
          (FLOOR(((ROW_NUMBER() OVER (ORDER BY "targetKey")) - 1)::numeric / ${normalizedExecutionBatchSize}) + 1)::integer AS "batchSequenceNumber"
        FROM "TargetSnapshotItem"
        WHERE "targetSnapshotSetId" = ${targetSnapshotSet.id}
      ) AS ranked
      WHERE item.id = ranked.id
    `;
  }

  await targetSnapshotService.activateTargetSnapshot(targetSnapshotSet.id, {
    targetCount: totalInserted,
    client,
  });

    return {
      count: totalInserted,
      targetSnapshotSetId: targetSnapshotSet.id,
      targetLevel: normalizedTargetLevel,
      catalogBatchId: resolvedCatalogBatchId,
      mirrorBatchId: resolvedCatalogBatchId,
    batchField,
    compiledWhereHash: resolvedCompiledWhereHash,
    canonicalFilterKey,
  };
}

export async function getFrozenTargetItems({
  ownerType,
  ownerId,
  shop,
  targetSnapshotSetId = null,
  limit = 500,
  cursorId = null,
  cursorTargetKey = null,
  targetCursorKey = null,
}) {
  const resolvedTargetCursorKey = targetCursorKey || cursorTargetKey || null;
  const targetSnapshotSet = targetSnapshotSetId
    ? await targetSnapshotService.getTargetSnapshotForExecution({
        targetSnapshotSetId,
        shop,
        ownerType,
        ownerId,
        status: "ACTIVE",
      })
    : await targetSnapshotService.getLatestTargetSnapshot({
        shop,
        ownerType,
        ownerId,
        status: "ACTIVE",
      });

  if (targetSnapshotSet?.id) {
    const rows = await targetSnapshotService.listTargetSnapshotItems({
      targetSnapshotSetId: targetSnapshotSet.id,
      take: limit,
      cursorProductId: cursorId,
      cursorTargetKey: resolvedTargetCursorKey,
    });

    return {
      rows: rows.map((row) => ({
        ...row,
        ownerType,
        ownerId,
        catalogBatchId: row.catalogBatchId || targetSnapshotSet.catalogBatchId || null,
        mirrorBatchId:
          row.catalogBatchId ||
          targetSnapshotSet.catalogBatchId ||
          targetSnapshotSet.mirrorBatchId,
      })),
      lastProductId: rows.length ? rows[rows.length - 1].productId : null,
      lastTargetKey: rows.length ? rows[rows.length - 1].targetKey : null,
      targetCursorKey: rows.length ? rows[rows.length - 1].targetKey : null,
      hasMore: rows.length === limit,
      targetSnapshotSetId: targetSnapshotSet.id,
      targetLevel: targetSnapshotSet.targetLevel || "PRODUCT",
      catalogSnapshotId: targetSnapshotSet.id,
      catalogBatchId: targetSnapshotSet.catalogBatchId || null,
      mirrorBatchId:
        targetSnapshotSet.catalogBatchId || targetSnapshotSet.mirrorBatchId || null,
    };
  }

  const error = new Error("Active TargetSnapshotSet is required for execution");
  error.code = "TARGET_SNAPSHOT_SET_REQUIRED";
  error.httpStatus = 409;
  error.details = {
    shop,
    ownerType,
    ownerId,
  };
  throw error;
}

export const getFrozenTargetProductIds = getFrozenTargetItems;

export async function markPreviewExecutionMismatch({
  shop,
  ownerType,
  ownerId,
  previewCount,
  frozenCount,
}) {
  await recordMirrorAnomaly({
    shop,
    severity: "high",
    type: "preview_execution_mismatch",
    entityType: ownerType,
    entityId: ownerId,
    message: `Preview count ${previewCount} differed from frozen execution count ${frozenCount}`,
    details: {
      previewCount,
      frozenCount,
    },
  });
}
