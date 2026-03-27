import { getCache, setCache } from "../../utils/cacheUtils.js";
import {
  buildPrismaSortQuery,
  getProductPrismaWhere,
} from "./productFilterCompiler.js";
import {
  countProducts,
  findDistinctCollectionTitles,
  findProductsForListing,
  findDistinctProductFieldValues,
  findDistinctProductTagValues,
  findDistinctVariantFieldValues,
} from "./productQueryRepository.js";

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
    .sort((a, b) => a.localeCompare(b))
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
  const { page = 1, limit = 20, sortKey, sortOrder } = queryParams;

  const cacheKey = `${shop}:ProductFetch:${JSON.stringify(queryParams)}:${JSON.stringify(filterParams)}`;
  const cachData = await getCache(cacheKey);

  if (cachData) return cachData;

  const where = getProductPrismaWhere(filterParams, shop);
  const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const perPage = parseInt(limit, 10);
  const orderBy = buildPrismaSortQuery(sortKey, sortOrder);

  const [products, count] = await Promise.all([
    findProductsForListing({
      where,
      orderBy,
      skip,
      take: perPage,
    }),
    countProducts(where),
  ]);

  const returnData = {
    products,
    count,
    pagination: {
      total: count,
      page: parseInt(page, 10),
      limit: perPage,
      totalPages: Math.ceil(count / perPage),
      hasNextPage: skip + perPage < count,
      hasPrevPage: parseInt(page, 10) > 1,
    },
  };

  await setCache(cacheKey, returnData, 300);

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

  let rows = [];

  if (fieldConfig.source === "product") {
    rows = await findDistinctProductFieldValues({
      shop,
      field: fieldConfig.field,
      search,
      take,
    });
  } else if (fieldConfig.source === "variant") {
    rows = await findDistinctVariantFieldValues({
      shop,
      field: fieldConfig.field,
      search,
      take,
    });
  } else if (fieldConfig.source === "collection") {
    rows = await findDistinctCollectionTitles({
      shop,
      search,
      take,
    });
  } else if (fieldConfig.source === "product_tags") {
    rows = await findDistinctProductTagValues({
      shop,
      search,
      take,
    });
  }

  const result = normalizeDistinctOptions(
    rows.map((row) => row?.[fieldConfig.field]),
    { splitValues: fieldConfig.splitValues === true },
  );

  await setCache(cacheKey, result, 300);

  return result;
}
