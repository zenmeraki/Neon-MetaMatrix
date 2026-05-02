import { Prisma } from "../../generated/prisma/index.js";
import { prisma } from "../../config/database.js";
import {
  buildProductOrderSql,
  compileFilterSql,
  normalizeFilterInput,
} from "./filterSqlCompiler.js";
import { filterCountCacheService } from "./filterCountCacheService.js";

function normalizeLimit(value, fallback = 50, max = 1000) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function normalizePage(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function buildCompiled({ filterParams, shop, mirrorBatchId }) {
  const ast = normalizeFilterInput(filterParams);
  return compileFilterSql({ ast, shop, mirrorBatchId });
}

export const productTargetRepository = {
  buildCompiled,

  async count({ filterParams = [], shop, mirrorBatchId, useCache = true }) {
    const compiled = buildCompiled({ filterParams, shop, mirrorBatchId });

    if (useCache) {
      const cached = await filterCountCacheService.get({
        shop,
        mirrorBatchId,
        canonicalFilterKey: compiled.canonicalFilterKey,
      });

      if (cached !== null) {
        return {
          count: cached,
          canonicalFilterKey: compiled.canonicalFilterKey,
          cacheHit: true,
        };
      }
    }

    const rows = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM "Product" p
      WHERE ${compiled.whereSql}
    `;

    const count = Number(rows?.[0]?.count || 0);

    if (useCache) {
      await filterCountCacheService.set({
        shop,
        mirrorBatchId,
        canonicalFilterKey: compiled.canonicalFilterKey,
        count,
      });
    }

    return {
      count,
      canonicalFilterKey: compiled.canonicalFilterKey,
      cacheHit: false,
    };
  },

  async page({
    filterParams = [],
    shop,
    mirrorBatchId,
    page = 1,
    limit = 50,
    cursorId = null,
    sortKey = "ID",
    sortOrder = "asc",
    select = "summary",
  }) {
    const take = normalizeLimit(limit);
    const pageNumber = normalizePage(page);
    const offset = (pageNumber - 1) * take;
    const compiled = buildCompiled({ filterParams, shop, mirrorBatchId });
    const orderSql = buildProductOrderSql(sortKey, sortOrder);
    const cursorSql = cursorId ? Prisma.sql`AND p."id" > ${cursorId}` : Prisma.empty;
    const projection =
      select === "ids"
        ? Prisma.sql`p."id"`
        : Prisma.sql`
            p."id",
            p."title",
            p."status",
            p."productType",
            p."vendor",
            p."totalInventory",
            p."featuredImageUrl",
            p."categoryName",
            p."handle",
            p."templateSuffix",
            p."variantCount",
            p."visibleOnlineStore"
          `;

    const rows = await prisma.$queryRaw`
      SELECT ${projection}
      FROM "Product" p
      WHERE ${compiled.whereSql}
      ${cursorSql}
      ORDER BY ${orderSql}
      ${cursorId ? Prisma.empty : Prisma.sql`OFFSET ${offset}`}
      LIMIT ${take}
    `;

    return {
      rows,
      productIds: rows.map((row) => row.id),
      canonicalFilterKey: compiled.canonicalFilterKey,
      pagination: {
        page: pageNumber,
        limit: take,
        offset,
        hasNextPage: rows.length === take,
        endCursor: rows.length ? rows[rows.length - 1].id : null,
      },
    };
  },

  async streamIds({
    filterParams = [],
    shop,
    mirrorBatchId,
    cursorId = null,
    limit = 1000,
  }) {
    return this.page({
      filterParams,
      shop,
      mirrorBatchId,
      cursorId,
      limit,
      sortKey: "ID",
      sortOrder: "asc",
      select: "ids",
    });
  },
};
