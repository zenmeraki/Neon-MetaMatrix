import { getCache, setCache } from "../../utils/cacheUtils.js";
import {
  findDistinctCollectionTitles,
  findDistinctProductFieldValues,
  findDistinctProductTagValues,
  findDistinctVariantFieldValues,
} from "./productQueryRepository.js";
import { prisma } from "../../config/database.js";
import { executeProductIdQuery } from "../filterPlanner/filterExecutionService.js";
import { productMirrorRepository } from "../../repositories/productMirrorRepository.js";

const FILTER_VALUE_FIELD_MAP = {
  vendor: { source: "product", field: "vendor" },
  tag: { source: "product_tags", field: "value" },
  product_type: { source: "product", field: "productType" },
  category: { source: "product", field: "categoryName" },
  option_name_1: { source: "product", field: "option1Name" },
  option_name_2: { source: "product", field: "option2Name" },
  option_name_3: { source: "product", field: "option3Name" },
  collection: { source: "collection", field: "title" },
  googleShoppingCategory: { source: "product", field: "googleShoppingCategory" },
  googleShoppingColor: { source: "product", field: "googleShoppingColor" },
  googleShoppingCustomLabel0: { source: "product", field: "googleShoppingCustomLabel0" },
  googleShoppingCustomLabel1: { source: "product", field: "googleShoppingCustomLabel1" },
  googleShoppingCustomLabel2: { source: "product", field: "googleShoppingCustomLabel2" },
  googleShoppingCustomLabel3: { source: "product", field: "googleShoppingCustomLabel3" },
  googleShoppingCustomLabel4: { source: "product", field: "googleShoppingCustomLabel4" },
  googleShoppingMpn: { source: "product", field: "googleShoppingMpn" },
  googleShoppingMaterial: { source: "product", field: "googleShoppingMaterial" },
  googleShoppingSize: { source: "product", field: "googleShoppingSize" },
  categoryAgeGroup: { source: "product", field: "categoryAgeGroup", splitValues: true },
  categoryColor: { source: "product", field: "categoryColor", splitValues: true },
  categoryFabric: { source: "product", field: "categoryFabric", splitValues: true },
  categoryFit: { source: "product", field: "categoryFit", splitValues: true },
  categorySize: { source: "product", field: "categorySize", splitValues: true },
  categoryTargetGender: { source: "product", field: "categoryTargetGender", splitValues: true },
  categoryWaistRise: { source: "product", field: "categoryWaistRise", splitValues: true },
  option_value_1: { source: "variant", field: "option1Value" },
  option_value_2: { source: "variant", field: "option2Value" },
  option_value_3: { source: "variant", field: "option3Value" },
  country_of_origin: { source: "variant", field: "countryOfOrigin" },
  inventory_policy: { source: "variant", field: "inventoryPolicy" },
  weight_unit: { source: "variant", field: "weightUnit" },
};

const MAX_PRODUCT_FILTER_CACHE_BYTES = 256 * 1024;

function stableNormalize(value) {
  if (Array.isArray(value)) {
    const normalizedItems = value.map((item) => stableNormalize(item));
    return normalizedItems.sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right), "en", {
        sensitivity: "base",
      }),
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

function buildProductFetchCacheKey({ shop, queryParams, filterParams }) {
  return `${shop}:ProductFetch:${stableStringify(queryParams)}:${stableStringify(filterParams)}`;
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
    (key) => key.toLowerCase() === lowerCaseField,
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
  const { page = 1, limit = 20 } = queryParams;

  const cacheKey = buildProductFetchCacheKey({
    shop,
    queryParams,
    filterParams,
  });
  const cachedData = await getCache(cacheKey);

  if (cachedData) return cachedData;

  const store = await prisma.store.findUnique({
    where: { shopUrl: shop },
    select: {
      activeMirrorBatchId: true,
      storeTotalProducts: true,
    },
  });

  if (!store) {
    throw new Error(`Store not found for shop: ${shop}`);
  }

  const mirrorBatchId = store?.activeMirrorBatchId || null;
  if (!mirrorBatchId) {
    throw new Error(`Active mirror batch not found for shop: ${shop}`);
  }

  const normalizedPage = Math.max(Number.parseInt(page, 10) || 1, 1);
  const normalizedLimit = Math.max(Number.parseInt(limit, 10) || 20, 1);
  const targetingResult = await executeProductIdQuery({
    filterParams,
    shop,
    mirrorBatchId,
    estimatedTotalRows: Number(store?.storeTotalProducts || 0),
    operation: "preview",
    page: normalizedPage,
    limit: normalizedLimit,
  });

  const products = await productMirrorRepository.findProductsForFrozenTarget({
    shop,
    mirrorBatchId,
    productIds: targetingResult.productIds,
    includeVariants: true,
  });

  const returnData = {
    products,
    count: targetingResult.totalCount,
    pagination: {
      total: targetingResult.totalCount,
      page: normalizedPage,
      limit: normalizedLimit,
      totalPages: Math.ceil(targetingResult.totalCount / normalizedLimit),
      hasNextPage: normalizedPage * normalizedLimit < targetingResult.totalCount,
      hasPrevPage: normalizedPage > 1,
    },
    mirrorBatchId,
    engine: targetingResult.engine,
    engineReason: targetingResult.reason,
  };

  const serializedReturnData = JSON.stringify(returnData);
  if (Buffer.byteLength(serializedReturnData, "utf8") <= MAX_PRODUCT_FILTER_CACHE_BYTES) {
    await setCache(cacheKey, returnData, 300);
  }

  return returnData;
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
      throw new Error(`Active mirror batch not found for shop: ${shop}`);
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
      throw new Error(`Active mirror batch not found for shop: ${shop}`);
    }

    rows = await findDistinctVariantFieldValues({
      shop,
      field: fieldConfig.field,
      mirrorBatchId,
      search,
      take,
    });
  } else if (fieldConfig.source === "collection") {
    rows = await findDistinctCollectionTitles({
      shop,
      mirrorBatchId: store?.activeCollectionBatchId || null,
      search,
      take,
    });
  } else if (fieldConfig.source === "product_tags") {
    if (!mirrorBatchId) {
      throw new Error(`Active mirror batch not found for shop: ${shop}`);
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
    { splitValues: fieldConfig.splitValues === true },
  );

  await setCache(cacheKey, result, 300);

  return result;
}
