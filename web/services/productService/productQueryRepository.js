//services/productService/productQueryRepository.js
import { Prisma } from "../../generated/prisma/index.js";
import { prisma } from "../../Config/database.js";

export async function findProductsForListing({ where, orderBy, skip, take }) {
  return prisma.product.findMany({
    where,
    select: {
      title: true,
      id: true,
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
    take,
  });
}

export async function countProducts(where) {
  return prisma.product.count({ where });
}

export async function findDistinctProductFieldValues({
  shop,
  field,
  mirrorBatchId = null,
  batchField = "catalogBatchId",
  search = "",
  take = 20,
}) {
  if (!mirrorBatchId) {
    throw new Error("catalogBatchId is required for product field value reads");
  }

  return prisma.product.findMany({
    where: {
      shop,
      ...(mirrorBatchId ? { [batchField]: mirrorBatchId } : {}),
      NOT: [{ [field]: null }, { [field]: "" }],
      ...(search
        ? {
            [field]: {
              contains: search,
              mode: "insensitive",
            },
          }
        : {}),
    },
    select: {
      [field]: true,
    },
    distinct: [field],
    orderBy: {
      [field]: "asc",
    },
    take,
  });
}

export async function findDistinctVariantFieldValues({
  shop,
  field,
  mirrorBatchId = null,
  batchField = "catalogBatchId",
  search = "",
  take = 20,
}) {
  if (!mirrorBatchId) {
    throw new Error("catalogBatchId is required for variant field value reads");
  }

  return prisma.variant.findMany({
    where: {
      shop,
      ...(mirrorBatchId ? { [batchField]: mirrorBatchId } : {}),
      NOT: [{ [field]: null }, { [field]: "" }],
      ...(search
        ? {
            [field]: {
              contains: search,
              mode: "insensitive",
            },
          }
        : {}),
    },
    select: {
      [field]: true,
    },
    distinct: [field],
    orderBy: {
      [field]: "asc",
    },
    take,
  });
}

export async function findDistinctCollectionTitles({
  shop,
  catalogBatchId = null,
  mirrorBatchId = null,
  search = "",
  take = 20,
}) {
  const resolvedCatalogBatchId = catalogBatchId || mirrorBatchId || null;

  return prisma.collection.findMany({
    where: {
      shop,
      ...(resolvedCatalogBatchId ? { catalogBatchId: resolvedCatalogBatchId } : {}),
      NOT: [{ title: null }, { title: "" }],
      ...(search
        ? {
            title: {
              contains: search,
              mode: "insensitive",
            },
          }
        : {}),
    },
    select: {
      title: true,
    },
    distinct: ["title"],
    orderBy: {
      title: "asc",
    },
    take,
  });
}

export async function findDistinctProductTagValues({
  shop,
  mirrorBatchId = null,
  batchField = "catalogBatchId",
  search = "",
  take = 20,
}) {
  if (!mirrorBatchId) {
    throw new Error("catalogBatchId is required for product tag reads");
  }

  const searchClause =
    search.trim().length > 0
      ? Prisma.sql`AND tag ILIKE ${`%${search.trim()}%`}`
      : Prisma.empty;
  const batchColumn =
    batchField === "mirrorBatchId" ? Prisma.sql`"mirrorBatchId"` : Prisma.sql`"catalogBatchId"`;
  const batchClause = mirrorBatchId
    ? Prisma.sql`AND ${batchColumn} = ${mirrorBatchId}`
    : Prisma.empty;

  return prisma.$queryRaw`
    SELECT DISTINCT tag AS value
    FROM "Product", UNNEST("tags") AS tag
    WHERE "shop" = ${shop}
      ${batchClause}
      AND tag IS NOT NULL
      AND BTRIM(tag) <> ''
      ${searchClause}
    ORDER BY tag ASC
    LIMIT ${take}
  `;
}
