import crypto from "crypto";
import { Prisma } from "../../generated/prisma/index.js";
import { prisma } from "../../config/database.js";
import { executeProductIdQuery } from "../filterPlanner/filterExecutionService.js";
import { getStoreMirrorState } from "../mirrorHealthService.js";
import { buildHotQueryCacheKey } from "../filterPlanner/hotQueryCache.js";
import { getCache, setCache } from "../../utils/cacheUtils.js";
import { getProductPrismaWhere } from "./productFilterCompiler.js";

export const CANONICAL_TARGET_PLANNER_VERSION = 1;
const TARGET_OWNER_TYPE = "AD_HOC_PRODUCT_TARGET";
const FREEZE_PAGE_SIZE = 1000;

function stableNormalize(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableNormalize(item));
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableNormalize(value[key]);
        return result;
      }, {});
  }
  return value;
}

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableNormalize(value)))
    .digest("hex");
}

function assertShop(shop) {
  if (typeof shop !== "string" || !shop.trim()) {
    throw new Error("shop is required");
  }
  return shop.trim();
}

function normalizeSort(sort = null, sortKey = null, sortOrder = null) {
  if (typeof sort === "string" && sort.trim()) {
    return { sortKey: sort.trim().toUpperCase(), sortOrder: "asc" };
  }
  return {
    sortKey: String(sortKey || "ID").trim().toUpperCase(),
    sortOrder:
      String(sortOrder || "asc").trim().toLowerCase() === "desc"
        ? "desc"
        : "asc",
  };
}

function normalizeFilters(filters, search) {
  const normalizedFilters = Array.isArray(filters) ? filters : [];
  const normalizedSearch = typeof search === "string" ? search.trim() : "";

  if (
    !normalizedSearch ||
    normalizedFilters.some((filter) => filter?.field === "search")
  ) {
    return normalizedFilters;
  }

  return [
    ...normalizedFilters,
    {
      field: "search",
      operator: "contains",
      value: normalizedSearch,
    },
  ];
}

function normalizeStringArray(value, maxItems = 10_000) {
  if (!Array.isArray(value)) return [];

  return [
    ...new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean),
    ),
  ].slice(0, maxItems);
}

export async function compileCanonicalTarget({
  shop,
  filters = [],
  search = "",
  sort = null,
  sortKey = null,
  sortOrder = null,
  excludedIds = [],
  operation = "preview",
}) {
  const safeShop = assertShop(shop);
  const mirrorState = await getStoreMirrorState(safeShop);
  const mirrorBatchId = mirrorState?.activeMirrorBatchId || null;
  if (!mirrorBatchId) {
    return {
      fingerprint: null,
      mirrorBatchId: null,
      sqlSignature: null,
      filters: [],
      orderBy: { key: "ID", order: "asc" },
      estimatedCount: 0,
      plannerVersion: CANONICAL_TARGET_PLANNER_VERSION,
      engine: "none",
      reason: "mirror_not_ready",
    };
  }

  const normalizedSort = normalizeSort(sort, sortKey, sortOrder);
  const normalizedFilters = normalizeFilters(filters, search);
  const normalizedExcludedIds = normalizeStringArray(excludedIds);

  const targetingResult = await executeProductIdQuery({
    filterParams: normalizedFilters,
    shop: safeShop,
    mirrorBatchId,
    estimatedTotalRows: Number(mirrorState?.storeTotalProducts || 0),
    operation,
    page: 1,
    limit: 1,
    sortKey: normalizedSort.sortKey,
    sortOrder: normalizedSort.sortOrder,
  });

  const fingerprint = stableHash({
    plannerVersion: CANONICAL_TARGET_PLANNER_VERSION,
    mirrorBatchId,
    filters: normalizedFilters,
    orderBy: normalizedSort,
    excludedIds: normalizedExcludedIds,
    engine: targetingResult.engine,
  });
  const sqlSignature = stableHash({
    mirrorBatchId,
    filters: normalizedFilters,
    sort: normalizedSort,
    engine: targetingResult.engine,
  });

  return {
    fingerprint,
    mirrorBatchId,
    sqlSignature,
    filters: normalizedFilters,
    orderBy: { key: normalizedSort.sortKey, order: normalizedSort.sortOrder },
    excludedIds: normalizedExcludedIds,
    estimatedCount: Number(targetingResult.totalCount || 0),
    plannerVersion: CANONICAL_TARGET_PLANNER_VERSION,
    engine: targetingResult.engine,
    reason: targetingResult.reason,
  };
}

export async function fetchCanonicalTargetPage({
  shop,
  plan,
  page = 1,
  limit = 50,
  operation = "preview",
}) {
  const safeShop = assertShop(shop);
  if (!plan?.mirrorBatchId) {
    return { productIds: [], totalCount: 0, engine: "none", reason: "mirror_not_ready" };
  }

  return executeProductIdQuery({
    filterParams: plan.filters,
    shop: safeShop,
    mirrorBatchId: plan.mirrorBatchId,
    estimatedTotalRows: Number(plan.estimatedCount || 0),
    operation,
    page,
    limit,
    sortKey: plan.orderBy?.key || "ID",
    sortOrder: plan.orderBy?.order || "asc",
  });
}

export async function freezeCanonicalTarget({
  shop,
  plan,
  targetSnapshotId,
}) {
  const safeShop = assertShop(shop);
  if (!targetSnapshotId || typeof targetSnapshotId !== "string") {
    throw new Error("targetSnapshotId is required");
  }
  if (!plan?.mirrorBatchId) {
    throw new Error("mirrorBatchId is required");
  }

  const cacheKey = buildHotQueryCacheKey({
    shop: safeShop,
    catalogBatchId: plan.mirrorBatchId,
    namespace: "target_freeze",
    ast: plan.filters,
    page: 1,
    limit: plan.estimatedCount || 0,
    sort: plan.orderBy,
    extra: {
      targetSnapshotId,
      fingerprint: plan.fingerprint,
      plannerVersion: plan.plannerVersion,
    },
  });
  const cached = await getCache(cacheKey);
  if (cached?.targetSnapshotId === targetSnapshotId && Number.isFinite(cached?.count)) {
    return cached;
  }

  const result = await prisma.$transaction(
    async (tx) => {
      await tx.targetSnapshot.deleteMany({
        where: {
          ownerType: TARGET_OWNER_TYPE,
          ownerId: targetSnapshotId,
          shop: safeShop,
        },
      });

      const total = Number(plan.estimatedCount || 0);
      if (total <= 0) {
        return { targetSnapshotId, count: 0 };
      }

      const usesIdCursor =
        String(plan?.orderBy?.key || "").toUpperCase() === "ID" &&
        String(plan?.orderBy?.order || "").toLowerCase() === "asc";
      const productWhere = getProductPrismaWhere(plan.filters || [], safeShop);
      productWhere.mirrorBatchId = plan.mirrorBatchId;
      const excluded = new Set(plan.excludedIds || []);

      let page = 1;
      let ordinal = 0;
      let cursorId = null;

      while (true) {
        let ids = [];
        if (usesIdCursor) {
          const cursorWhere = cursorId
            ? {
                AND: [productWhere, { id: { gt: cursorId } }],
              }
            : productWhere;
          const rows = await tx.product.findMany({
            where: cursorWhere,
            select: { id: true },
            orderBy: { id: "asc" },
            take: FREEZE_PAGE_SIZE,
          });
          ids = rows.map((row) => row.id);
          cursorId = ids.length ? ids[ids.length - 1] : cursorId;
        } else {
          const batch = await fetchCanonicalTargetPage({
            shop: safeShop,
            plan,
            page,
            limit: FREEZE_PAGE_SIZE,
            operation: "freeze",
          });
          ids = Array.isArray(batch?.productIds) ? batch.productIds : [];
        }

        ids = ids.filter((id) => !excluded.has(id));
        if (!ids.length) break;

        await tx.targetSnapshot.createMany({
          data: ids.map((productId, index) => ({
            ownerType: TARGET_OWNER_TYPE,
            ownerId: targetSnapshotId,
            shop: safeShop,
            productId,
            ordinal: ordinal + index + 1,
            mirrorBatchId: plan.mirrorBatchId,
            plannerFingerprint: plan.fingerprint || null,
            plannerVersion: Number(plan.plannerVersion || CANONICAL_TARGET_PLANNER_VERSION),
            canonicalQueryHash: plan.sqlSignature || null,
            canonicalOrderBy: plan.orderBy || null,
          })),
          skipDuplicates: true,
        });

        ordinal += ids.length;
        if (ids.length < FREEZE_PAGE_SIZE) break;
        if (!usesIdCursor) {
          page += 1;
        }
      }

      return { targetSnapshotId, count: ordinal };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 10_000,
      timeout: 300_000,
    },
  );

  await setCache(cacheKey, result, 120);
  return result;
}

export async function resolveCanonicalTargetIds({
  shop,
  plan,
  pageSize = FREEZE_PAGE_SIZE,
  operation = "count",
}) {
  const ids = [];
  const excluded = new Set(plan?.excludedIds || []);
  let page = 1;
  while (true) {
    const batch = await fetchCanonicalTargetPage({
      shop,
      plan,
      page,
      limit: pageSize,
      operation,
    });
    const pageIds = (Array.isArray(batch?.productIds) ? batch.productIds : []).filter(
      (id) => !excluded.has(id),
    );
    if (!pageIds.length) break;
    ids.push(...pageIds);
    if (pageIds.length < pageSize) break;
    page += 1;
  }
  return ids;
}

export async function countCanonicalTargetAggregates({
  shop,
  plan,
}) {
  const safeShop = assertShop(shop);
  if (!plan?.mirrorBatchId) {
    return { total: 0, vendorsCount: 0, typesCount: 0, inStockCount: 0 };
  }

  const where = getProductPrismaWhere(plan.filters || [], safeShop);
  where.mirrorBatchId = plan.mirrorBatchId;

  const [total, inStockCount, vendorGroups, typeGroups] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.count({
      where: {
        AND: [where, { totalInventory: { gt: 0 } }],
      },
    }),
    prisma.product.groupBy({
      by: ["vendor"],
      where: {
        AND: [where, { vendor: { not: null } }, { NOT: { vendor: "" } }],
      },
    }),
    prisma.product.groupBy({
      by: ["productType"],
      where: {
        AND: [where, { productType: { not: null } }, { NOT: { productType: "" } }],
      },
    }),
  ]);

  return {
    total,
    vendorsCount: vendorGroups.length,
    typesCount: typeGroups.length,
    inStockCount,
  };
}
