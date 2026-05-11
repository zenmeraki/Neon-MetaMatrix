//services/productService/productQueryRepository.js
import { Prisma } from "../../generated/prisma/index.js";
import { prisma } from "../../config/database.js";

const ALLOWED_PRODUCT_DISTINCT_FIELDS = new Set([
  "vendor",
  "productType",
  "categoryName",
  "option1Name",
  "option2Name",
  "option3Name",
  "googleShoppingCategory",
  "googleShoppingColor",
  "googleShoppingCustomLabel0",
  "googleShoppingCustomLabel1",
  "googleShoppingCustomLabel2",
  "googleShoppingCustomLabel3",
  "googleShoppingCustomLabel4",
  "googleShoppingMpn",
  "googleShoppingMaterial",
  "googleShoppingSize",
  "categoryAgeGroup",
  "categoryColor",
  "categoryFabric",
  "categoryFit",
  "categorySize",
  "categoryTargetGender",
  "categoryWaistRise",
]);

const ALLOWED_VARIANT_DISTINCT_FIELDS = new Set([
  "option1Value",
  "option2Value",
  "option3Value",
  "countryOfOrigin",
  "inventoryPolicy",
  "weightUnit",
]);

function assertShop(shop) {
  if (typeof shop !== "string" || !shop.trim()) {
    throw new Error("shop is required");
  }

  return shop.trim();
}

function normalizeTake(take, fallback = 20, max = 100) {
  const parsed = Number.parseInt(take, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function normalizeSearch(search) {
  return typeof search === "string" ? search.trim() : "";
}

function assertDistinctField(field, allowedFields, modelName) {
  if (!allowedFields.has(field)) {
    throw new Error(`Unsupported ${modelName} distinct field`);
  }

  return field;
}

export async function findProductsForListing({ where, orderBy, skip, take }) {
  const safeWhere = where && typeof where === "object" ? where : {};

  if (typeof safeWhere.shop !== "string" || !safeWhere.shop.trim()) {
    throw new Error("shop-scoped where clause is required for product listing");
  }

  return prisma.product.findMany({
    where: safeWhere,
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
  const safeShop = assertShop(shop);
  const safeField = assertDistinctField(
    field,
    ALLOWED_PRODUCT_DISTINCT_FIELDS,
    "product",
  );
  const safeSearch = normalizeSearch(search);
  const safeTake = normalizeTake(take);

  return prisma.product.findMany({
    where: {
      shop: safeShop,
      ...(mirrorBatchId ? { mirrorBatchId } : {}),
      NOT: [{ [safeField]: null }, { [safeField]: "" }],
      ...(safeSearch
        ? {
            [safeField]: {
              contains: safeSearch,
              mode: "insensitive",
            },
          }
        : {}),
    },
    select: {
      [safeField]: true,
    },
    distinct: [safeField],
    orderBy: {
      [safeField]: "asc",
    },
    take: safeTake,
  });
}

export async function findDistinctVariantFieldValues({
  shop,
  field,
  mirrorBatchId = null,
  search = "",
  take = 20,
}) {
  const safeShop = assertShop(shop);
  const safeField = assertDistinctField(
    field,
    ALLOWED_VARIANT_DISTINCT_FIELDS,
    "variant",
  );
  const safeSearch = normalizeSearch(search);
  const safeTake = normalizeTake(take);

  return prisma.variant.findMany({
    where: {
      shop: safeShop,
      ...(mirrorBatchId ? { mirrorBatchId } : {}),
      NOT: [{ [safeField]: null }, { [safeField]: "" }],
      ...(safeSearch
        ? {
            [safeField]: {
              contains: safeSearch,
              mode: "insensitive",
            },
          }
        : {}),
    },
    select: {
      [safeField]: true,
    },
    distinct: [safeField],
    orderBy: {
      [safeField]: "asc",
    },
    take: safeTake,
  });
}

export async function findDistinctCollectionTitles({
  shop,
  mirrorBatchId = null,
  search = "",
  take = 20,
}) {
  const safeShop = assertShop(shop);
  const safeSearch = normalizeSearch(search);
  const safeTake = normalizeTake(take);

  return prisma.collection.findMany({
    where: {
      shop: safeShop,
      ...(mirrorBatchId ? { mirrorBatchId } : {}),
      NOT: [{ title: null }, { title: "" }],
      ...(safeSearch
        ? {
            title: {
              contains: safeSearch,
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
    take: safeTake,
  });
}

export async function findDistinctProductTagValues({
  shop,
  mirrorBatchId = null,
  search = "",
  take = 20,
}) {
  const safeShop = assertShop(shop);
  const safeSearch = normalizeSearch(search);
  const safeTake = normalizeTake(take);
  const searchClause =
    safeSearch.length > 0
      ? Prisma.sql`AND tag ILIKE ${`%${safeSearch}%`}`
      : Prisma.empty;
  const mirrorBatchClause = mirrorBatchId
    ? Prisma.sql`AND p."mirrorBatchId" = ${mirrorBatchId}`
    : Prisma.empty;

  return prisma.$queryRaw`
    SELECT DISTINCT tag AS value
    FROM "Product" AS p
    CROSS JOIN LATERAL UNNEST(p."tags") AS tag
    WHERE p."shop" = ${safeShop}
      ${mirrorBatchClause}
      AND tag IS NOT NULL
      AND BTRIM(tag) <> ''
      ${searchClause}
    ORDER BY tag ASC
    LIMIT ${safeTake}
  `;
}
