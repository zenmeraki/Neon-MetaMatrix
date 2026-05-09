import crypto from "crypto";
import {
  compileCanonicalTarget,
  freezeCanonicalTarget,
  resolveCanonicalTargetIds,
} from "../services/productService/canonicalTargetingService.js";
import { errorResponse } from "../utils/responseUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { prisma } from "../config/database.js";
import {
  buildHotQueryCacheKey,
  getHotQueryCache,
  setHotQueryCache,
} from "../services/filterPlanner/hotQueryCache.js";
import { choosePlanner } from "../services/filterPlanner/queryCostPlannerService.js";

const TARGET_OWNER_TYPE = "AD_HOC_PRODUCT_TARGET";
const MAX_EXCLUDED_IDS = 10_000;
const MAX_DIRECT_IDS = 10_000;

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

function buildQuerySignature({ filters, search, sort, excludedIds }) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        stableNormalize({
          filters,
          search,
          sort,
          excludedIds,
        })
      )
    )
    .digest("hex");
}

function createTargetSnapshotId() {
  return `target_${crypto.randomBytes(12).toString("hex")}`;
}

function normalizeStringArray(value, maxItems) {
  if (!Array.isArray(value)) return [];

  return [
    ...new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    ),
  ].slice(0, maxItems);
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

function withExcludedIds(where, excludedIds) {
  if (!excludedIds.length) return where;

  return {
    AND: [
      where,
      {
        NOT: {
          id: {
            in: excludedIds,
          },
        },
      },
    ],
  };
}

function normalizeSort(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;

  return value;
}

export const freezeProductTarget = async (req, res) => {
  const session = res.locals.shopify?.session;

  try {
    if (!session?.shop) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const mode = req.body?.mode === "ids" ? "ids" : "query";
    const targetSnapshotId = createTargetSnapshotId();

    if (mode === "ids") {
      const ids = normalizeStringArray(req.body?.ids, MAX_DIRECT_IDS);

      if (!ids.length) {
        return res
          .status(400)
          .json(errorResponse("At least one product id is required"));
      }

      const target = await resolveCanonicalProductTarget({
        shop: session.shop,
        explicitProductIds: ids,
        queryParams: { page: 1, limit: 1 },
        sampleLimit: 1,
        freeze: true,
        ownerType: TARGET_OWNER_TYPE,
        ownerId: targetSnapshotId,
      });

      return res.status(200).json({
        targetSnapshotId,
        count: target.frozenCount ?? target.count ?? 0,
      });
    }

    const filters = normalizeFilters(req.body?.filters, req.body?.search);
    const excludedIds = normalizeStringArray(
      req.body?.excludedIds,
      MAX_EXCLUDED_IDS
    );
    const sort = normalizeSort(req.body?.sort);
    const computedQuerySignature = buildQuerySignature({
      filters,
      search:
        typeof req.body?.search === "string" ? req.body.search.trim() : "",
      sort,
      excludedIds,
    });

    if (
      req.body?.querySignature &&
      String(req.body.querySignature) !== computedQuerySignature &&
      process.env.NODE_ENV !== "production"
    ) {
      console.warn("Product target query signature mismatch", {
        shop: session.shop,
        received: req.body.querySignature,
        computed: computedQuerySignature,
      });
    }

    const plan = await compileCanonicalTarget({
      shop: session.shop,
      filters: withExcludedIds(filters, excludedIds),
      sort: sort || "ID",
      operation: "freeze",
    });
    const target = await freezeCanonicalTarget({
      shop: session.shop,
      plan,
      targetSnapshotId,
    });

    return res.status(200).json({
      targetSnapshotId,
      count: target.count ?? 0,
      plannerVersion: plan.plannerVersion,
      plannerFingerprint: plan.fingerprint,
      sqlSignature: plan.sqlSignature,
      mirrorBatchId: plan.mirrorBatchId,
      canonicalOrderBy: plan.orderBy,
    });
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/products/targets/freeze",
    });

    return res
      .status(400)
      .json(errorResponse(err.message || "Failed to freeze product target"));
  }
};

export const countProductTarget = async (req, res) => {
  const session = res.locals.shopify?.session;

  try {
    if (!session?.shop) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const store = await prisma.store.findUnique({
      where: { shopUrl: session.shop },
      select: { activeMirrorBatchId: true, storeTotalProducts: true },
    });

    if (!store?.activeMirrorBatchId) {
      return res.status(200).json({
        total: 0,
        vendorsCount: 0,
        typesCount: 0,
        inStockCount: 0,
      });
    }

    const filters = normalizeFilters(req.body?.filters, req.body?.search);
    const sort = normalizeSort(req.body?.sort);
    const excludedIds = normalizeStringArray(
      req.body?.excludedIds,
      MAX_EXCLUDED_IDS
    );
    const countCacheKey = buildHotQueryCacheKey({
      shop: session.shop,
      catalogBatchId: store.activeMirrorBatchId,
      namespace: "target_count",
      ast: filters,
      page: 1,
      limit: 1,
      sort,
      extra: {
        search:
          typeof req.body?.search === "string" ? req.body.search.trim() : "",
        excludedIds,
      },
    });
    const cachedCount = await getHotQueryCache(countCacheKey);

    if (cachedCount) {
      return res.status(200).json(cachedCount);
    }

    const plan = await compileCanonicalTarget({
      shop: session.shop,
      filters: withExcludedIds(filters, excludedIds),
      sort: sort || "ID",
      operation: "count",
    });
    const targetIds = await resolveCanonicalTargetIds({
      shop: session.shop,
      plan,
      operation: "count",
    });
    const total = targetIds.length;
    const vendorSet = new Set();
    const typeSet = new Set();
    let inStockCount = 0;
    const chunkSize = 1000;
    for (let index = 0; index < targetIds.length; index += chunkSize) {
      const chunk = targetIds.slice(index, index + chunkSize);
      if (!chunk.length) continue;
      const rows = await prisma.product.findMany({
        where: {
          shop: session.shop,
          mirrorBatchId: plan.mirrorBatchId,
          id: { in: chunk },
        },
        select: {
          vendor: true,
          productType: true,
          totalInventory: true,
        },
      });
      for (const row of rows) {
        if (typeof row.vendor === "string" && row.vendor.trim()) {
          vendorSet.add(row.vendor);
        }
        if (typeof row.productType === "string" && row.productType.trim()) {
          typeSet.add(row.productType);
        }
        if (Number(row.totalInventory || 0) > 0) {
          inStockCount += 1;
        }
      }
    }

    const result = {
      total,
      vendorsCount: vendorSet.size,
      typesCount: typeSet.size,
      inStockCount,
      plannerVersion: plan.plannerVersion,
      plannerFingerprint: plan.fingerprint,
      sqlSignature: plan.sqlSignature,
      mirrorBatchId: plan.mirrorBatchId,
      canonicalOrderBy: plan.orderBy,
      queryPlan: choosePlanner({
        estimatedRows: store.storeTotalProducts || total,
        hasClickHouse: Boolean(process.env.CLICKHOUSE_URL),
      }),
    };

    await setHotQueryCache(countCacheKey, result);

    return res.status(200).json(result);
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/products/targets/count",
    });

    return res
      .status(400)
      .json(errorResponse(err.message || "Failed to count product target"));
  }
};
