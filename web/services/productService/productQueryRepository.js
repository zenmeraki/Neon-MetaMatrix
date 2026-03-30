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
  search = "",
  take = 20,
}) {
  return prisma.product.findMany({
    where: {
      shop,
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
  search = "",
  take = 20,
}) {
  return prisma.variant.findMany({
    where: {
      shop,
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
  search = "",
  take = 20,
}) {
  return prisma.collection.findMany({
    where: {
      shop,
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
  search = "",
  take = 20,
}) {
  const searchClause =
    search.trim().length > 0
      ? Prisma.sql`AND tag ILIKE ${`%${search.trim()}%`}`
      : Prisma.empty;

  return prisma.$queryRaw`
    SELECT DISTINCT tag AS value
    FROM "Product", UNNEST("tags") AS tag
    WHERE "shop" = ${shop}
      AND tag IS NOT NULL
      AND BTRIM(tag) <> ''
      ${searchClause}
    ORDER BY tag ASC
    LIMIT ${take}
  `;
}
