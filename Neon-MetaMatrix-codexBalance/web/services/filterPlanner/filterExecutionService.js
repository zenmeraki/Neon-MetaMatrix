import { prisma } from "../../config/database.js";
import { Prisma } from "../../generated/prisma/index.js";
import {
  compileOrderBySql,
  compileProductWhereSql,
} from "./productFilterSqlCompiler.js";

function normalizePagination(page, limit) {
  const safePage = Math.max(Number.parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 250);

  return {
    page: safePage,
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
  };
}

export async function executeProductIdQuery({
  shop,
  mirrorBatchId,
  filterParams = [],
  page = 1,
  limit = 20,
  sortKey = "TITLE",
  sortOrder = "asc",
}) {
  const { page: safePage, limit: safeLimit, offset } = normalizePagination(
    page,
    limit,
  );

  const whereSql = compileProductWhereSql({
    shop,
    mirrorBatchId,
    filterParams,
  });
  const orderBySql = compileOrderBySql(sortKey, sortOrder);

  const [countRows, idRows] = await prisma.$transaction([
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM "Product" p
      WHERE ${whereSql}
    `,
    prisma.$queryRaw`
      SELECT p."id"
      FROM "Product" p
      WHERE ${whereSql}
      ORDER BY ${orderBySql}
      LIMIT ${safeLimit}
      OFFSET ${offset}
    `,
  ]);

  const totalCount = Number(countRows?.[0]?.count || 0);

  return {
    engine: "sql",
    reason: "raw_sql_filter_compiler",
    totalCount,
    pagination: {
      page: safePage,
      limit: safeLimit,
      offset,
      hasNextPage: offset + safeLimit < totalCount,
      hasPrevPage: safePage > 1,
    },
    productIds: idRows.map((row) => row.id),
  };
}

export async function freezeTargetSnapshotFromFilter({
  ownerType,
  ownerId,
  shop,
  mirrorBatchId,
  filterParams = [],
}) {
  if (!ownerType || !ownerId) {
    throw new Error("ownerType and ownerId are required");
  }

  const whereSql = compileProductWhereSql({
    shop,
    mirrorBatchId,
    filterParams,
  });

  await prisma.targetSnapshot.deleteMany({
    where: {
      ownerType,
      ownerId,
      shop,
    },
  });

  const rows = await prisma.$queryRaw`
    INSERT INTO "TargetSnapshot" (
      "id",
      "ownerType",
      "ownerId",
      "shop",
      "productId",
      "ordinal",
      "mirrorBatchId",
      "createdAt",
      "updatedAt"
    )
    SELECT
      gen_random_uuid()::text,
      ${ownerType},
      ${ownerId},
      p."shop",
      p."id",
      ROW_NUMBER() OVER (ORDER BY p."id" ASC)::int,
      p."mirrorBatchId",
      NOW(),
      NOW()
    FROM "Product" p
    WHERE ${whereSql}
    ON CONFLICT ("ownerType", "ownerId", "productId") DO NOTHING
    RETURNING "productId"
  `;

  return {
    count: rows.length,
  };
}

export async function streamProductIdsFromFilter({
  shop,
  mirrorBatchId,
  filterParams = [],
  cursorId = null,
  take = 5000,
}) {
  const safeTake = Math.min(Math.max(Number(take) || 5000, 1), 10000);
  const whereSql = compileProductWhereSql({
    shop,
    mirrorBatchId,
    filterParams,
  });
  const cursorSql = cursorId
    ? Prisma.sql`AND p."id" > ${cursorId}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw`
    SELECT p."id"
    FROM "Product" p
    WHERE ${whereSql}
      ${cursorSql}
    ORDER BY p."id" ASC
    LIMIT ${safeTake}
  `;

  return rows.map((row) => row.id);
}

export async function executeFilter({
  filterParams,
  context,
  page = 1,
  limit = 20,
  sortKey = "TITLE",
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
