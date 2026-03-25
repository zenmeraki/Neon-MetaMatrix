import { getCache, setCache } from "../../utils/cacheUtils.js";
import {
  buildPrismaSortQuery,
  getProductPrismaWhere,
} from "./productFilterCompiler.js";
import {
  countProducts,
  findProductsForListing,
} from "./productQueryRepository.js";

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
