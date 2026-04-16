import {
  buildPrismaArrayStringFilter,
  buildPrismaBooleanFilter,
  buildPrismaDateFilter,
  buildPrismaNumberFilter,
  buildPrismaSortQuery,
  buildPrismaStringFilter,
  getProductPrismaWhere,
} from "./productFilterCompiler.js";
import {
  getDistinctProductFilterValues,
  getProductsWithFilters,
} from "./productQueryService.js";

/**
 * Product filter/query service only.
 * Catalog sync orchestration belongs in web/services/sync/catalogSyncService.js.
 */
export class ProductFilterService {
  async getProductsWithFilters({
    queryParams = {},
    filterParams = [],
    shop = null,
  }) {
    return getProductsWithFilters({
      queryParams,
      filterParams,
      shop,
    });
  }

  async getDistinctProductFilterValues({
    shop,
    field,
    search = "",
    take = 20,
  }) {
    return getDistinctProductFilterValues({
      shop,
      field,
      search,
      take,
    });
  }

  getProductPrismaWhere(filterParams = [], shop, catalogBatchId = null) {
    return getProductPrismaWhere(filterParams, shop, catalogBatchId);
  }

  buildPrismaSortQuery(sortKey, sortOrder) {
    return buildPrismaSortQuery(sortKey, sortOrder);
  }

  buildPrismaStringFilter(field, operator, value) {
    return buildPrismaStringFilter(field, operator, value);
  }

  buildPrismaNumberFilter(field, operator, value) {
    return buildPrismaNumberFilter(field, operator, value);
  }

  buildPrismaBooleanFilter(field, operator, value) {
    return buildPrismaBooleanFilter(field, operator, value);
  }

  buildPrismaDateFilter(field, operator, value) {
    return buildPrismaDateFilter(field, operator, value);
  }

  buildPrismaArrayStringFilter(field, operator, value) {
    return buildPrismaArrayStringFilter(field, operator, value);
  }

}

export {
  buildPrismaArrayStringFilter,
  buildPrismaBooleanFilter,
  buildPrismaDateFilter,
  buildPrismaNumberFilter,
  buildPrismaSortQuery,
  buildPrismaStringFilter,
  getProductPrismaWhere,
  getDistinctProductFilterValues,
  getProductsWithFilters,
};

export default ProductFilterService;
