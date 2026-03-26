import { getCache, setCache } from "../../utils/cacheUtils.js";
import {
  buildPrismaSortQuery,
  getProductPrismaWhere,
} from "./productFilterCompiler.js";
import {
  countProducts,
  findProductsForListing,
  findDistinctProductFieldValues,
} from "./productQueryRepository.js";

const FILTER_VALUE_FIELD_MAP = {
  googleShoppingCategory: "googleShoppingCategory",
  googleShoppingColor: "googleShoppingColor",
  googleShoppingCustomLabel0: "googleShoppingCustomLabel0",
  googleShoppingCustomLabel1: "googleShoppingCustomLabel1",
  googleShoppingCustomLabel2: "googleShoppingCustomLabel2",
  googleShoppingCustomLabel3: "googleShoppingCustomLabel3",
  googleShoppingCustomLabel4: "googleShoppingCustomLabel4",
  googleShoppingMpn: "googleShoppingMpn",
  googleShoppingMaterial: "googleShoppingMaterial",
  googleShoppingSize: "googleShoppingSize",
  categoryColor: "categoryColor",
  categoryFabric: "categoryFabric",
  categoryFit: "categoryFit",
  categorySize: "categorySize",
};

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
  const prismaField = FILTER_VALUE_FIELD_MAP[field];
  if (!prismaField) {
    throw new Error("Unsupported filter field");
  }

  const cacheKey = `${shop}:ProductFilterValues:${field}:${search.toLowerCase()}:${take}`;
  const cachedData = await getCache(cacheKey);
  if (cachedData) return cachedData;

  const rows = await findDistinctProductFieldValues({
    shop,
    field: prismaField,
    search,
    take,
  });

  const result = rows
    .map((row) => row?.[prismaField])
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .map((title) => ({ title }));

  await setCache(cacheKey, result, 300);

  return result;
}
