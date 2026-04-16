import {
  buildPrismaArrayStringFilter,
  buildPrismaBooleanFilter,
  buildPrismaCollectionFilter,
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
import {
  formatAndSyncProductsToDB,
  startBulkOperationToFetchProducts,
} from "./productSyncService.js";


export class Services {
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

  getProductPrismaWhere(filterParams = [], shop) {
    return getProductPrismaWhere(filterParams, shop);
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

  buildPrismaCollectionFilter(operator, value) {
    return buildPrismaCollectionFilter(operator, value);
  }

  async startBulkOperationToFetchProducts({
    session,
    isInitialSync = false,
  }) {
    return startBulkOperationToFetchProducts({
      session,
      isInitialSync,
    });
  }

  async formatAndSyncProductsToDB({
    dataStream,
    shop,
    session,
    syncBatchId,
    syncHistoryId = null,
  }) {
    return formatAndSyncProductsToDB({
      dataStream,
      shop,
      session,
      syncBatchId,
      syncHistoryId,
    });
  }
}