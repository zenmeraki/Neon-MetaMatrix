import { Prisma } from "../../generated/prisma/index.js";
import { prisma } from "../../config/database.js";

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
  search = "",
  take = 20,
}) {
  return prisma.product.findMany({
    where: {
      shop,
      ...(mirrorBatchId ? { mirrorBatchId } : {}),
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
  search = "",
  take = 20,
}) {
  return prisma.variant.findMany({
    where: {
      shop,
      ...(mirrorBatchId ? { mirrorBatchId } : {}),
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
  mirrorBatchId = null,
  search = "",
  take = 20,
}) {
  return prisma.collection.findMany({
    where: {
      shop,
      ...(mirrorBatchId ? { mirrorBatchId } : {}),
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
  search = "",
  take = 20,
}) {
  const searchClause =
    search.trim().length > 0
      ? Prisma.sql`AND tag ILIKE ${`%${search.trim()}%`}`
      : Prisma.empty;
  const mirrorBatchClause = mirrorBatchId
    ? Prisma.sql`AND "mirrorBatchId" = ${mirrorBatchId}`
    : Prisma.empty;

  return prisma.$queryRaw`
    SELECT DISTINCT tag AS value
    FROM "Product", UNNEST("tags") AS tag
    WHERE "shop" = ${shop}
      ${mirrorBatchClause}
      AND tag IS NOT NULL
      AND BTRIM(tag) <> ''
      ${searchClause}
    ORDER BY tag ASC
    LIMIT ${take}
  `;
}

export async function findDistinctCollectionTitlesFromProducts({
  shop,
  mirrorBatchId = null,
  search = "",
  take = 20,
}) {
  const searchClause =
    search.trim().length > 0
      ? Prisma.sql`AND collection_title ILIKE ${`%${search.trim()}%`}`
      : Prisma.empty;
  const mirrorBatchClause = mirrorBatchId
    ? Prisma.sql`AND p."mirrorBatchId" = ${mirrorBatchId}`
    : Prisma.empty;

  return prisma.$queryRaw`
    SELECT DISTINCT collection_title AS title
    FROM (
      SELECT NULLIF(BTRIM(collection_item ->> 'title'), '') AS collection_title
      FROM "Product" p,
           LATERAL jsonb_array_elements(COALESCE(p."collectionsJson", '[]'::jsonb)) AS collection_item
      WHERE p."shop" = ${shop}
        ${mirrorBatchClause}
    ) collection_rows
    WHERE collection_title IS NOT NULL
      ${searchClause}
    ORDER BY collection_title ASC
    LIMIT ${take}
  `;
}
