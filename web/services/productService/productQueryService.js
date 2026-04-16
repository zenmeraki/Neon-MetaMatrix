import { getCache, setCache } from "../../utils/cacheUtils.js";
import {
  findDistinctProductFieldValues,
  findDistinctProductTagValues,
  findDistinctVariantFieldValues,
} from "./productQueryRepository.js";
import {
  resolveProductReadBatchScope,
  resolveCanonicalProductTarget,
} from "./productTargetingService.js";
import * as domainFreshnessService from "../sync/domainFreshnessService.js";
import * as collectionMembershipRepository from "../../repositories/collectionMembershipRepository.js";
import { getStoreMirrorState } from "../mirrorHealthService.js";
import { recordFilterUsage } from "../filterTrackingService.js";

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

export function isSupportedProductFilterValueField(field) {
  return Object.prototype.hasOwnProperty.call(FILTER_VALUE_FIELD_MAP, field);
}

const PRODUCT_QUERY_FIELD_DOMAIN_MAP = {
  collection: [domainFreshnessService.FRESHNESS_DOMAIN.COLLECTION],
  product_type: [domainFreshnessService.FRESHNESS_DOMAIN.PRODUCT_TYPE],
  variant_inventory_q: [domainFreshnessService.FRESHNESS_DOMAIN.INVENTORY],
  inventory_q: [domainFreshnessService.FRESHNESS_DOMAIN.INVENTORY],
  // inventory_at_location queries VariantInventoryLevel directly — requires
  // INVENTORY domain freshness, not just the baseline Variant row.
  inventory_at_location: [domainFreshnessService.FRESHNESS_DOMAIN.INVENTORY],
};

const FILTER_SOURCE_DOMAIN_MAP = {
  product: [domainFreshnessService.FRESHNESS_DOMAIN.PRODUCT],
  product_tags: [domainFreshnessService.FRESHNESS_DOMAIN.PRODUCT],
  variant: [domainFreshnessService.FRESHNESS_DOMAIN.PRODUCT],
  collection: [domainFreshnessService.FRESHNESS_DOMAIN.COLLECTION],
  inventory_location: [domainFreshnessService.FRESHNESS_DOMAIN.INVENTORY],
};

const getRequiredDomainsForProductQuery = (filterParams = []) => {
  const requiredDomains = new Set([
    domainFreshnessService.FRESHNESS_DOMAIN.PRODUCT,
  ]);

  for (const filter of Array.isArray(filterParams) ? filterParams : []) {
    const field = filter?.field;
    const mappedDomains = PRODUCT_QUERY_FIELD_DOMAIN_MAP[field];

    if (Array.isArray(mappedDomains)) {
      mappedDomains.forEach((domain) => requiredDomains.add(domain));
    }
  }

  return Array.from(requiredDomains);
};

const getRequiredDomainsForFilterValueField = (fieldConfig) => {
  return FILTER_SOURCE_DOMAIN_MAP[fieldConfig.source] || [
    domainFreshnessService.FRESHNESS_DOMAIN.PRODUCT,
  ];
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

function buildMirrorReadContract(mirrorState) {
  const healthState = mirrorState?.mirrorHealthState || "UNKNOWN";
  const authoritative =
    healthState === "HEALTHY" &&
    mirrorState?.repairRequired !== true &&
    !mirrorState?.staleReason;

  return {
    mode: authoritative ? "authoritative" : "degraded_read",
    authoritative,
    healthState,
    staleReason: mirrorState?.staleReason || null,
    repairRequired: mirrorState?.repairRequired === true,
  };
}

export async function getProductsWithFilters({
  queryParams = {},
  filterParams = [],
  shop = null,
}) {
  const { page = 1, limit = 20, sortKey, sortOrder } = queryParams;
  await domainFreshnessService.assertDomainsFresh({
    shop,
    domains: getRequiredDomainsForProductQuery(filterParams),
    source: "productQueryService.getProductsWithFilters",
  });

  const batchScope = await resolveProductReadBatchScope({
    shop,
    path: "preview",
  });
  const activeCatalogBatchId = batchScope.catalogBatchId;
  const cacheKey = `${shop}:ProductFetch:${activeCatalogBatchId || "no-active-batch"}:${JSON.stringify(queryParams)}:${JSON.stringify(filterParams)}`;
  const cachedData = await getCache(cacheKey);

  if (cachedData) return cachedData;

  const result = await resolveCanonicalProductTarget({
    shop,
    filterParams,
    queryParams: { page, limit, sortKey, sortOrder },
    sampleLimit: Number.parseInt(limit, 10) || 20,
    snapshot: batchScope,
  });

  const returnData = {
    products: result.sampleProducts,
    count: result.count,
    pagination: result.pagination,
    mirrorBatchId: result.mirrorBatchId,
    catalogBatchId: result.catalogBatchId,
    batchScope: result.batchScope,
  };

  await setCache(cacheKey, returnData, 300);

  return returnData;
}

export async function getProductListing({
  shop,
  queryParams = {},
  filterParams = [],
}) {
  const [result, mirrorState] = await Promise.all([
    getProductsWithFilters({
      queryParams,
      filterParams,
      shop,
    }),
    getStoreMirrorState(shop),
  ]);

  void recordFilterUsage({
    shop,
    filterParams,
    respondProductCount: result?.count || 0,
    type: "filter",
  }).catch(() => {});

  return {
    ...result,
    mirrorHealth: mirrorState,
    mirrorReadContract: buildMirrorReadContract(mirrorState),
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

  await domainFreshnessService.assertDomainsFresh({
    shop,
    domains: getRequiredDomainsForFilterValueField(fieldConfig),
    source: "productQueryService.getDistinctProductFilterValues",
  });

  const batchScope = await resolveProductReadBatchScope({
    shop,
    path: "preview",
  });
  const catalogBatchId = batchScope.catalogBatchId;
  let rows = [];

  const cacheKey = `${shop}:ProductFilterValues:${field}:${catalogBatchId || "no-active-batch"}:${search.toLowerCase()}:${take}`;
  const cachedData = await getCache(cacheKey);
  if (cachedData) return cachedData;

  if (fieldConfig.source === "product") {
    rows = await findDistinctProductFieldValues({
      shop,
      field: fieldConfig.field,
      mirrorBatchId: catalogBatchId,
      batchField: batchScope.batchField,
      search,
      take,
    });
  } else if (fieldConfig.source === "variant") {
    rows = await findDistinctVariantFieldValues({
      shop,
      field: fieldConfig.field,
      mirrorBatchId: catalogBatchId,
      batchField: batchScope.batchField,
      search,
      take,
    });
  } else if (fieldConfig.source === "collection") {
    rows = await collectionMembershipRepository.findDistinctCollectionTitlesByBatch({
      shop,
      catalogBatchId,
      search,
      take,
    });
  } else if (fieldConfig.source === "product_tags") {
    rows = await findDistinctProductTagValues({
      shop,
      mirrorBatchId: catalogBatchId,
      batchField: batchScope.batchField,
      search,
      take,
    });
  }

  const result = normalizeDistinctOptions(
    rows.map((row) => row?.[fieldConfig.field] ?? row?.collectionTitle),
    { splitValues: fieldConfig.splitValues === true },
  );

  await setCache(cacheKey, result, 300);

  return result;
}
