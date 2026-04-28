import { prisma } from "../../config/database.js";
import {
  getClickHouseClient,
  isClickHouseConfigured,
} from "../../config/clickhouse.js";
import { Prisma } from "../../generated/prisma/index.js";
import { buildPrismaProductOrderBy, buildQueryPlan } from "./queryPlanner.js";
import { buildClickHouseProductIdQuery } from "./clickhouseCompiler.js";
import { bitmapCacheService } from "./bitmapCacheService.js";

const BITMAP_CACHE_OPERATIONS = new Set([
  "preview",
  "export",
  "facet",
  "count",
]);

async function ensureMirrorBatchExists(shop, mirrorBatchId) {
  const store = await prisma.store.findUnique({
    where: { shopUrl: shop },
    select: { activeMirrorBatchId: true },
  });

  if (store?.activeMirrorBatchId === mirrorBatchId) {
    return;
  }

  const anyProductInBatch = await prisma.product.findFirst({
    where: {
      shop,
      mirrorBatchId,
    },
    select: { id: true },
  });

  if (!anyProductInBatch) {
    throw new Error(`Mirror batch not found for shop: ${mirrorBatchId}`);
  }
}

async function executeClickHouseQuery(compiledQuery) {
  const client = getClickHouseClient();
  const result = await client.query({
    query: compiledQuery.sql,
    query_params: compiledQuery.params,
    format: "JSONEachRow",
  });

  return result.json();
}

function isDefaultBitmapSort(sort) {
  return sort?.key === "ID" && sort?.order === "asc";
}

function isBitmapCacheEligible(operation, sort) {
  return (
    BITMAP_CACHE_OPERATIONS.has(
      String(operation || "")
        .trim()
        .toLowerCase()
    ) && isDefaultBitmapSort(sort)
  );
}

async function executeClickHousePlan(plan) {
  const rows = await executeClickHouseQuery(
    plan.productIdPageQuery || plan.productIdQuery
  );
  const totalCount = Number(rows?.[0]?.total_count || 0);

  return {
    engine: "clickhouse",
    reason: plan.reason,
    totalCount,
    pagination: plan.pagination,
    productIds: rows
      .map((row) => row.product_id)
      .filter((productId) => typeof productId === "string" && productId),
  };
}

async function executeClickHousePlanAllIds(
  plan,
  shop,
  mirrorBatchId,
  totalCount
) {
  if (!Number.isFinite(totalCount) || totalCount <= 0) {
    return [];
  }

  const rows = await executeClickHouseQuery(
    buildClickHouseProductIdQuery({
      ast: plan.ast,
      shop,
      mirrorBatchId,
      limit: totalCount,
      offset: 0,
      sort: plan.sort,
    })
  );

  return rows
    .map((row) => row.product_id)
    .filter((productId) => typeof productId === "string" && productId);
}

async function executePostgresPlan(plan) {
  const result = await prisma.$transaction(
    async (tx) => {
      const totalCount = await tx.product.count({
        where: plan.where,
      });

      const products = await tx.product.findMany({
        where: plan.where,
        select: { id: true },
        orderBy: buildPrismaProductOrderBy(plan.sort),
        skip: plan.pagination.offset,
        take: plan.pagination.limit,
      });

      return {
        totalCount,
        products,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    }
  );

  return {
    engine: "postgres",
    reason: plan.reason,
    totalCount: result.totalCount,
    pagination: plan.pagination,
    productIds: result.products.map((product) => product.id),
  };
}

async function executePostgresPlanAllIds(plan, totalCount) {
  if (!Number.isFinite(totalCount) || totalCount <= 0) {
    return [];
  }

  const products = await prisma.product.findMany({
    where: plan.where,
    select: { id: true },
    orderBy: buildPrismaProductOrderBy(plan.sort),
    take: totalCount,
  });

  return products.map((product) => product.id);
}

async function seedBitmapCache({
  plan,
  shop,
  mirrorBatchId,
  operation,
  totalCount,
}) {
  if (!isBitmapCacheEligible(operation, plan.sort)) {
    return;
  }

  if (totalCount <= 0 || totalCount > bitmapCacheService.maxProductIds) {
    return;
  }

  try {
    const allProductIds =
      plan.engine === "clickhouse"
        ? await executeClickHousePlanAllIds(
            plan,
            shop,
            mirrorBatchId,
            totalCount
          )
        : await executePostgresPlanAllIds(plan, totalCount);

    if (allProductIds.length !== totalCount) {
      return;
    }

    await bitmapCacheService.set({
      shop,
      mirrorBatchId,
      ast: plan.ast,
      operation,
      productIds: allProductIds,
    });
  } catch {
    // Cache population must never fail the primary query path.
  }
}

async function executeWithBitmapCache({
  plan,
  shop,
  mirrorBatchId,
  operation,
  executeMiss,
}) {
  if (!isBitmapCacheEligible(operation, plan.sort)) {
    return executeMiss();
  }

  const cached = await bitmapCacheService.get({
    shop,
    mirrorBatchId,
    ast: plan.ast,
    operation,
  });

  if (cached) {
    const { offset, limit } = plan.pagination;

    return {
      engine: `${plan.engine}+bitmap_cache`,
      reason: "bitmap_cache_hit",
      totalCount: cached.count,
      pagination: plan.pagination,
      productIds: cached.orderedProductIds.slice(offset, offset + limit),
    };
  }

  const result = await executeMiss();
  await seedBitmapCache({
    plan,
    shop,
    mirrorBatchId,
    operation,
    totalCount: result.totalCount,
  });

  return {
    ...result,
    reason: `${result.reason || plan.reason}:bitmap_cache_miss`,
  };
}

export async function executeProductIdQuery({
  filterParams,
  shop,
  mirrorBatchId,
  estimatedTotalRows,
  operation = "preview",
  page = 1,
  limit = 50,
  sortKey = "ID",
  sortOrder = "asc",
}) {
  await ensureMirrorBatchExists(shop, mirrorBatchId);

  const plan = buildQueryPlan({
    filterParams,
    shop,
    mirrorBatchId,
    estimatedTotalRows,
    operation,
    page,
    limit,
    sortKey,
    sortOrder,
  });

  if (plan.engine === "clickhouse" && !isClickHouseConfigured()) {
    throw new Error("ClickHouse is not configured");
  }

  return executeWithBitmapCache({
    plan,
    shop,
    mirrorBatchId,
    operation,
    executeMiss: async () => {
      if (plan.engine === "clickhouse") {
        return executeClickHousePlan(plan);
      }

      return executePostgresPlan(plan);
    },
  });
}

export async function executeFilter({
  filterParams,
  context,
  estimatedTotalRows,
  operation = "preview",
  page = 1,
  limit = 50,
  sortKey = "ID",
  sortOrder = "asc",
}) {
  if (!context?.shop) {
    throw new Error("context.shop is required");
  }

  if (!context?.mirrorBatchId) {
    throw new Error("context.mirrorBatchId is required");
  }

  return executeProductIdQuery({
    filterParams,
    shop: context.shop,
    mirrorBatchId: context.mirrorBatchId,
    estimatedTotalRows,
    operation,
    page,
    limit,
    sortKey,
    sortOrder,
  });
}

export class FilterExecutionService {
  static async executeProductIdQuery(args) {
    return executeProductIdQuery(args);
  }

  static async executeFilter(args) {
    return executeFilter(args);
  }
}
