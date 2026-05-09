import { getCache, setCache } from "../../utils/cacheUtils.js";
import { Prisma } from "../../generated/prisma/index.js";
import {
  findDistinctCollectionTitles,
  findDistinctProductFieldValues,
  findDistinctProductTagValues,
  findDistinctVariantFieldValues,
} from "./productQueryRepository.js";
import { prisma } from "../../config/database.js";
import { productMirrorRepository } from "../../repositories/productMirrorRepository.js";
import { hashHotQueryPart } from "../filterPlanner/hotQueryCache.js";
import {
  getProductPrismaWhere,
} from "./productFilterCompiler.js";

const FILTER_VALUE_FIELD_MAP = {
  vendor: { source: "product", field: "vendor" },
  tag: { source: "product_tags", field: "value" },
  product_type: { source: "product", field: "productType" },
  category: { source: "product", field: "categoryName" },
  option_name_1: { source: "product", field: "option1Name" },
  option_name_2: { source: "product", field: "option2Name" },
  option_name_3: { source: "product", field: "option3Name" },
  collection: { source: "collection", field: "title" },
  googleShoppingCategory: {
    source: "product",
    field: "googleShoppingCategory",
  },
  googleShoppingColor: { source: "product", field: "googleShoppingColor" },
  googleShoppingCustomLabel0: {
    source: "product",
    field: "googleShoppingCustomLabel0",
  },
  googleShoppingCustomLabel1: {
    source: "product",
    field: "googleShoppingCustomLabel1",
  },
  googleShoppingCustomLabel2: {
    source: "product",
    field: "googleShoppingCustomLabel2",
  },
  googleShoppingCustomLabel3: {
    source: "product",
    field: "googleShoppingCustomLabel3",
  },
  googleShoppingCustomLabel4: {
    source: "product",
    field: "googleShoppingCustomLabel4",
  },
  googleShoppingMpn: { source: "product", field: "googleShoppingMpn" },
  googleShoppingMaterial: {
    source: "product",
    field: "googleShoppingMaterial",
  },
  googleShoppingSize: { source: "product", field: "googleShoppingSize" },
  categoryAgeGroup: {
    source: "product",
    field: "categoryAgeGroup",
    splitValues: true,
  },
  categoryColor: {
    source: "product",
    field: "categoryColor",
    splitValues: true,
  },
  categoryFabric: {
    source: "product",
    field: "categoryFabric",
    splitValues: true,
  },
  categoryFit: { source: "product", field: "categoryFit", splitValues: true },
  categorySize: { source: "product", field: "categorySize", splitValues: true },
  categoryTargetGender: {
    source: "product",
    field: "categoryTargetGender",
    splitValues: true,
  },
  categoryWaistRise: {
    source: "product",
    field: "categoryWaistRise",
    splitValues: true,
  },
  option_value_1: { source: "variant", field: "option1Value" },
  option_value_2: { source: "variant", field: "option2Value" },
  option_value_3: { source: "variant", field: "option3Value" },
  country_of_origin: { source: "variant", field: "countryOfOrigin" },
  inventory_policy: { source: "variant", field: "inventoryPolicy" },
  weight_unit: { source: "variant", field: "weightUnit" },
};

const MAX_PRODUCT_FILTER_CACHE_BYTES = 256 * 1024;
const ADVANCED_FILTER_FIELDS = new Set([
  "has_images",
  "no_images",
  "has_duplicate_sku",
  "has_duplicate_barcode",
  "has_duplicate_title",
  "not_in_manual_collection",
  "price_lt_compare_at_price",
  "price_eq_compare_at_price",
  "price_gt_compare_at_price",
]);

function stableNormalize(value) {
  if (Array.isArray(value)) {
    const normalizedItems = value.map((item) => stableNormalize(item));
    return normalizedItems.sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right), "en", {
        sensitivity: "base",
      })
    );
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

function stableStringify(value) {
  return JSON.stringify(stableNormalize(value));
}

function buildProductFetchCacheKey({
  shop,
  mirrorBatchId,
  page,
  cursor,
  limit,
  sortKey,
  sortOrder,
  filterParams,
}) {
  return [
    shop,
    "HotProductQuery",
    mirrorBatchId,
    "hydrated_products_page",
    hashHotQueryPart({
      filterParams,
      page,
      cursor,
      limit,
      sortKey,
      sortOrder,
    }),
  ].join(":");
}

function getDistinctRowValue(row, field) {
  if (!row || typeof row !== "object") {
    return undefined;
  }

  if (field in row) {
    return row[field];
  }

  const lowerCaseField = String(field).toLowerCase();
  const matchingKey = Object.keys(row).find(
    (key) => key.toLowerCase() === lowerCaseField
  );

  return matchingKey ? row[matchingKey] : undefined;
}

function normalizeDistinctOptions(values = [], { splitValues = false } = {}) {
  const normalizedValues = values.flatMap((value) => {
    if (typeof value !== "string") {
      return [];
    }

    if (!splitValues) {
      const normalized = value.trim();
      return normalized ? [normalized] : [];
    }

    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  });

  return Array.from(new Set(normalizedValues))
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))
    .map((value) => ({
      label: value,
      value,
      title: value,
    }));
}

export async function getProductsWithFilters({
  queryParams = {},
  filterParams = [],
  shop = null,
}) {
  const {
    page = 1,
    limit = 20,
    cursor = null,
    sortKey = "TITLE",
    sortOrder = "asc",
  } = queryParams;

  const store = await prisma.store.findUnique({
    where: { shopUrl: shop },
    select: {
      activeMirrorBatchId: true,
      activeCollectionBatchId: true,
      storeTotalProducts: true,
    },
  });

  if (!store) {
    throw new Error(`Store not found for shop: ${shop}`);
  }

  const mirrorBatchId = store?.activeMirrorBatchId || null;
  const normalizedPage = Math.max(Number.parseInt(page, 10) || 1, 1);
  const normalizedLimit = Math.max(Number.parseInt(limit, 10) || 20, 1);
  const normalizedCursor =
    typeof cursor === "string" && cursor.trim() ? cursor.trim() : null;
  const cacheKey = mirrorBatchId
    ? buildProductFetchCacheKey({
        shop,
        mirrorBatchId,
        page: normalizedPage,
        cursor: normalizedCursor,
        limit: normalizedLimit,
        sortKey: "ID",
        sortOrder: "asc",
        filterParams,
      })
    : null;
  const cachedData = cacheKey ? await getCache(cacheKey) : null;

  if (cachedData) return cachedData;

  if (!mirrorBatchId) {
    const emptyResult = {
      products: [],
      count: 0,
      pagination: {
        total: 0,
        page: normalizedPage,
        limit: normalizedLimit,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false,
      },
      mirrorBatchId: null,
      engine: "none",
      engineReason: "product mirror has not been synced yet",
    };
    return emptyResult;
  }

  const {
    normalizedFilters,
    constrainedProductIds,
  } = await resolveAdvancedFilterConstraints({
    shop,
    mirrorBatchId,
    collectionBatchId: store?.activeCollectionBatchId || null,
    filterParams,
  });

  if (Array.isArray(constrainedProductIds) && constrainedProductIds.length === 0) {
    return {
      products: [],
      count: 0,
      pagination: {
        total: 0,
        page: normalizedPage,
        limit: normalizedLimit,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false,
      },
      mirrorBatchId,
      engine: "postgres",
      engineReason: "advanced_filter_empty_set",
    };
  }

  const effectiveFilters = Array.isArray(constrainedProductIds)
    ? [
        ...normalizedFilters,
        {
          field: "product_id",
          operator: "in",
          value: constrainedProductIds,
        },
      ]
    : normalizedFilters;

  const where = getProductPrismaWhere(effectiveFilters, shop);
  where.mirrorBatchId = mirrorBatchId;

  const pageWhere = normalizedCursor
    ? {
        AND: [where, { id: { gt: normalizedCursor } }],
      }
    : where;

  const [totalCount, idRows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where: pageWhere,
      select: { id: true },
      orderBy: { id: "asc" },
      take: normalizedLimit + 1,
    }),
  ]);

  const hasNextPage = idRows.length > normalizedLimit;
  const pageRows = hasNextPage ? idRows.slice(0, normalizedLimit) : idRows;
  const productIds = pageRows.map((row) => row.id);
  const nextCursor =
    hasNextPage && productIds.length
      ? productIds[productIds.length - 1]
      : null;

  const products = await productMirrorRepository.findProductsForFrozenTarget({
    shop,
    mirrorBatchId,
    productIds,
    includeVariants: true,
  });

  const returnData = {
    products,
    count: totalCount,
    pagination: {
      total: totalCount,
      page: normalizedPage,
      limit: normalizedLimit,
      totalPages: Math.ceil(totalCount / normalizedLimit),
      hasNextPage,
      hasPrevPage: Boolean(normalizedCursor),
      cursor: normalizedCursor,
      nextCursor,
    },
    mirrorBatchId,
    engine: "postgres",
    engineReason: "keyset_cursor_id",
  };

  const serializedReturnData = JSON.stringify(returnData);
  if (
    Buffer.byteLength(serializedReturnData, "utf8") <=
    MAX_PRODUCT_FILTER_CACHE_BYTES
  ) {
    await setCache(cacheKey, returnData, 300);
  }

  return returnData;
}

async function resolveAdvancedFilterConstraints({
  shop,
  mirrorBatchId,
  collectionBatchId = null,
  filterParams = [],
}) {
  const normalizedFilters = [];
  const activeAdvancedFields = new Set();

  for (const filter of Array.isArray(filterParams) ? filterParams : []) {
    const field = String(filter?.field || "").trim();
    if (ADVANCED_FILTER_FIELDS.has(field)) {
      activeAdvancedFields.add(field);
      continue;
    }
    normalizedFilters.push(filter);
  }

  if (!activeAdvancedFields.size || !mirrorBatchId) {
    return {
      normalizedFilters,
      constrainedProductIds: null,
    };
  }

  const clauses = [];

  if (activeAdvancedFields.has("has_images")) {
    clauses.push(
      Prisma.sql`SELECT p.id FROM "Product" p
      WHERE p.shop = ${shop}
        AND p."mirrorBatchId" = ${mirrorBatchId}
        AND p."featuredImageUrl" IS NOT NULL
        AND BTRIM(p."featuredImageUrl") <> ''`,
    );
  }

  if (activeAdvancedFields.has("no_images")) {
    clauses.push(
      Prisma.sql`SELECT p.id FROM "Product" p
      WHERE p.shop = ${shop}
        AND p."mirrorBatchId" = ${mirrorBatchId}
        AND (p."featuredImageUrl" IS NULL OR BTRIM(p."featuredImageUrl") = '')`,
    );
  }

  if (activeAdvancedFields.has("has_duplicate_title")) {
    clauses.push(
      Prisma.sql`SELECT p.id
      FROM "Product" p
      JOIN (
        SELECT LOWER(BTRIM(title)) AS t
        FROM "Product"
        WHERE shop = ${shop}
          AND "mirrorBatchId" = ${mirrorBatchId}
          AND title IS NOT NULL
          AND BTRIM(title) <> ''
        GROUP BY LOWER(BTRIM(title))
        HAVING COUNT(*) > 1
      ) dup ON LOWER(BTRIM(p.title)) = dup.t
      WHERE p.shop = ${shop}
        AND p."mirrorBatchId" = ${mirrorBatchId}`,
    );
  }

  if (activeAdvancedFields.has("not_in_manual_collection")) {
    if (collectionBatchId) {
      clauses.push(
        Prisma.sql`SELECT p.id
        FROM "Product" p
        WHERE p.shop = ${shop}
          AND p."mirrorBatchId" = ${mirrorBatchId}
          AND NOT EXISTS (
            SELECT 1
            FROM "ProductCollectionMembership" pcm
            JOIN "Collection" c
              ON c.shop = pcm.shop
             AND c."mirrorBatchId" = pcm."mirrorBatchId"
             AND c."shopifyId" = pcm."collectionId"
            WHERE pcm.shop = p.shop
              AND pcm."productId" = p.id
              AND pcm."mirrorBatchId" = ${collectionBatchId}
              AND UPPER(COALESCE(c."collectionType", '')) = 'MANUAL'
          )`,
      );
    } else {
      clauses.push(
        Prisma.sql`SELECT p.id
        FROM "Product" p
        WHERE p.shop = ${shop}
          AND p."mirrorBatchId" = ${mirrorBatchId}
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(p."collectionsJson", '[]'::jsonb)) AS elem
            WHERE UPPER(COALESCE(elem->>'type', '')) = 'MANUAL'
          )`,
      );
    }
  }

  if (activeAdvancedFields.has("has_duplicate_sku")) {
    clauses.push(
      Prisma.sql`SELECT DISTINCT p.id
      FROM "Product" p
      JOIN "Variant" v ON v.shop = p.shop AND v."productId" = p.id AND v."mirrorBatchId" = p."mirrorBatchId"
      JOIN (
        SELECT LOWER(BTRIM(sku)) AS sku_key
        FROM "Variant"
        WHERE shop = ${shop}
          AND "mirrorBatchId" = ${mirrorBatchId}
          AND sku IS NOT NULL
          AND BTRIM(sku) <> ''
        GROUP BY LOWER(BTRIM(sku))
        HAVING COUNT(*) > 1
      ) dup ON LOWER(BTRIM(v.sku)) = dup.sku_key
      WHERE p.shop = ${shop}
        AND p."mirrorBatchId" = ${mirrorBatchId}`,
    );
  }

  if (activeAdvancedFields.has("has_duplicate_barcode")) {
    clauses.push(
      Prisma.sql`SELECT DISTINCT p.id
      FROM "Product" p
      JOIN "Variant" v ON v.shop = p.shop AND v."productId" = p.id AND v."mirrorBatchId" = p."mirrorBatchId"
      JOIN (
        SELECT LOWER(BTRIM(barcode)) AS barcode_key
        FROM "Variant"
        WHERE shop = ${shop}
          AND "mirrorBatchId" = ${mirrorBatchId}
          AND barcode IS NOT NULL
          AND BTRIM(barcode) <> ''
        GROUP BY LOWER(BTRIM(barcode))
        HAVING COUNT(*) > 1
      ) dup ON LOWER(BTRIM(v.barcode)) = dup.barcode_key
      WHERE p.shop = ${shop}
        AND p."mirrorBatchId" = ${mirrorBatchId}`,
    );
  }

  if (activeAdvancedFields.has("price_lt_compare_at_price")) {
    clauses.push(
      Prisma.sql`SELECT DISTINCT p.id
      FROM "Product" p
      JOIN "Variant" v ON v.shop = p.shop AND v."productId" = p.id AND v."mirrorBatchId" = p."mirrorBatchId"
      WHERE p.shop = ${shop}
        AND p."mirrorBatchId" = ${mirrorBatchId}
        AND v.price IS NOT NULL
        AND v."compareAtPrice" IS NOT NULL
        AND v.price < v."compareAtPrice"`,
    );
  }

  if (activeAdvancedFields.has("price_eq_compare_at_price")) {
    clauses.push(
      Prisma.sql`SELECT DISTINCT p.id
      FROM "Product" p
      JOIN "Variant" v ON v.shop = p.shop AND v."productId" = p.id AND v."mirrorBatchId" = p."mirrorBatchId"
      WHERE p.shop = ${shop}
        AND p."mirrorBatchId" = ${mirrorBatchId}
        AND v.price IS NOT NULL
        AND v."compareAtPrice" IS NOT NULL
        AND v.price = v."compareAtPrice"`,
    );
  }

  if (activeAdvancedFields.has("price_gt_compare_at_price")) {
    clauses.push(
      Prisma.sql`SELECT DISTINCT p.id
      FROM "Product" p
      JOIN "Variant" v ON v.shop = p.shop AND v."productId" = p.id AND v."mirrorBatchId" = p."mirrorBatchId"
      WHERE p.shop = ${shop}
        AND p."mirrorBatchId" = ${mirrorBatchId}
        AND v.price IS NOT NULL
        AND v."compareAtPrice" IS NOT NULL
        AND v.price > v."compareAtPrice"`,
    );
  }

  if (!clauses.length) {
    return {
      normalizedFilters,
      constrainedProductIds: null,
    };
  }

  let constrainedProductIds = null;
  for (const clause of clauses) {
    const rows = await prisma.$queryRaw(clause);
    const ids = Array.isArray(rows)
      ? rows.map((row) => row?.id).filter((id) => typeof id === "string" && id)
      : [];
    const nextSet = new Set(ids);

    if (constrainedProductIds === null) {
      constrainedProductIds = ids;
      continue;
    }

    constrainedProductIds = constrainedProductIds.filter((id) => nextSet.has(id));
  }

  return {
    normalizedFilters,
    constrainedProductIds: constrainedProductIds ?? null,
  };
}

export async function getDistinctProductFilterValues({
  shop,
  field,
  search = "",
  take = 20,
}) {
  const fieldConfig = FILTER_VALUE_FIELD_MAP[field];
  if (!fieldConfig) {
    throw new Error("Unsupported filter field");
  }

  const cacheKey = `${shop}:ProductFilterValues:${field}:${search.toLowerCase()}:${take}`;
  const cachedData = await getCache(cacheKey);
  if (cachedData) return cachedData;

  const store = await prisma.store.findUnique({
    where: { shopUrl: shop },
    select: {
      activeMirrorBatchId: true,
      activeCollectionBatchId: true,
    },
  });

  if (!store) {
    throw new Error(`Store not found for shop: ${shop}`);
  }

  const mirrorBatchId = store.activeMirrorBatchId || null;
  let rows = [];

  if (fieldConfig.source === "product") {
    if (!mirrorBatchId) {
      return [];
    }

    rows = await findDistinctProductFieldValues({
      shop,
      field: fieldConfig.field,
      mirrorBatchId,
      search,
      take,
    });
  } else if (fieldConfig.source === "variant") {
    if (!mirrorBatchId) {
      return [];
    }

    rows = await findDistinctVariantFieldValues({
      shop,
      field: fieldConfig.field,
      mirrorBatchId,
      search,
      take,
    });
  } else if (fieldConfig.source === "collection") {
    if (!store?.activeCollectionBatchId) {
      return [];
    }

    rows = await findDistinctCollectionTitles({
      shop,
      mirrorBatchId: store.activeCollectionBatchId,
      search,
      take,
    });
  } else if (fieldConfig.source === "product_tags") {
    if (!mirrorBatchId) {
      return [];
    }

    rows = await findDistinctProductTagValues({
      shop,
      mirrorBatchId,
      search,
      take,
    });
  }

  const result = normalizeDistinctOptions(
    rows.map((row) => getDistinctRowValue(row, fieldConfig.field)),
    { splitValues: fieldConfig.splitValues === true }
  );

  await setCache(cacheKey, result, 300);

  return result;
}
