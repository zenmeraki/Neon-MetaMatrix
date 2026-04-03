import { Services } from "../services/productService/productFilterService.js";
import { successResponse, errorResponse } from "../utils/responseUtils.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getCache, setCache } from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { prisma } from "../config/database.js";
import { getStoreMirrorState } from "../services/mirrorHealthService.js";
import { trackFilterUsage } from "../services/productQueryTrackingService.js";
import { normalizeCanonicalFilterParams } from "../services/productService/productFilterContract.js";

const productService = new Services();
const MAX_SEARCH_LENGTH = 100;
const FILTER_VALUE_FIELDS = new Set([
  "vendor",
  "tag",
  "product_type",
  "category",
  "option_name_1",
  "option_name_2",
  "option_name_3",
  "collection",
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
  "option_value_1",
  "option_value_2",
  "option_value_3",
  "country_of_origin",
  "inventory_policy",
  "weight_unit",
]);

function successOptionResponse(message, data) {
  return {
    success: true,
    message,
    count: Array.isArray(data) ? data.length : 0,
    data,
  };
}

function buildHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.userMessage = message;
  return error;
}

function getSessionShop(res) {
  const session = res.locals.shopify?.session;
  const shop = session?.shop;

  if (!shop) {
    throw buildHttpError(401, "Session expired. Please reload the app.");
  }

  return { session, shop };
}

function normalizeSearch(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, MAX_SEARCH_LENGTH);
}

function normalizePositiveInteger(value, fallback, { min = 1, max = 250 } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function normalizeQueryParams(query = {}) {
  const allowedSortKeys = new Set([
    "CREATED_AT",
    "ID",
    "INVENTORY_TOTAL",
    "PRODUCT_TYPE",
    "PUBLISHED_AT",
    "TITLE",
    "UPDATED_AT",
    "VENDOR",
    "",
    undefined,
    null,
  ]);

  const normalizedSortKey = allowedSortKeys.has(query.sortKey)
    ? query.sortKey || undefined
    : undefined;
  const normalizedSortOrder = query.sortOrder === "asc" ? "asc" : "desc";

  return {
    ...query,
    page: normalizePositiveInteger(query.page, 1, { min: 1, max: 10000 }),
    limit: normalizePositiveInteger(query.limit, 20, { min: 1, max: 100 }),
    sortKey: normalizedSortKey,
    sortOrder: normalizedSortOrder,
    search: normalizeSearch(query.search),
  };
}

function normalizeFilterParams(filterParams) {
  try {
    return normalizeCanonicalFilterParams(filterParams);
  } catch (error) {
    throw buildHttpError(400, error.message || "Invalid filter parameters.");
  }
}

function normalizeFieldParam(field) {
  const normalizedField = String(field || "").trim();

  if (!FILTER_VALUE_FIELDS.has(normalizedField)) {
    throw buildHttpError(400, "Unsupported filter field.");
  }

  return normalizedField;
}

export const getProductsWithQuery = asyncHandler(async (req, res) => {
  const { shop } = getSessionShop(res);
  const normalizedQueryParams = normalizeQueryParams(req.query);
  const normalizedFilterParams = normalizeFilterParams(req.body?.filterParams);

  try {
    const [result, mirrorState] = await Promise.all([
      productService.getProductsWithFilters({
        queryParams: normalizedQueryParams,
        filterParams: normalizedFilterParams,
        shop,
      }),
      getStoreMirrorState(shop),
    ]);

    trackFilterUsage({
      shop,
      filterParams: normalizedFilterParams,
      respondProductCount: result?.count || 0,
    });

    return res
      .status(200)
      .json(successResponse("Products fetched successfully", {
        ...result,
        mirrorHealth: mirrorState,
      }));
  } catch (err) {
    await logApiError({
      shop,
      err,
      req,
      source: "GET /api/products",
    });

    return res.status(500).json(errorResponse("Failed to fetch products"));
  }
});

export const checkEditStatus = asyncHandler(async (req, res) => {
  const { shop } = getSessionShop(res);
  const id = String(req.params.id || "").trim();

  if (!id) {
    return res.status(400).json(errorResponse("Edit history id is required"));
  }

  const history = await prisma.editHistory.findFirst({
    where: {
      id,
      shop,
    },
    select: {
      processedCount: true,
      totalItems: true,
      durationMs: true,
    },
  });

  if (!history) {
    return res.status(404).json(errorResponse("Edit history not found"));
  }

  return res.status(200).json({
    rootObjectCount: history.processedCount,
    totalItems: history.totalItems,
    duration: history.durationMs,
  });
});

export const getProductTypes = asyncHandler(async (req, res) => {
  const { shop } = getSessionShop(res);
  const search = normalizeSearch(req.query.search);
  const cacheKey = `${shop}:productTypes:${search.toLowerCase()}`;
  const cached = await getCache(cacheKey);

  if (cached) {
    return res
      .status(200)
      .json(successOptionResponse("Product types fetched from cache", cached));
  }

  try {
    const productTypes = await productService.getDistinctProductFilterValues({
      shop,
      field: "product_type",
      search,
      take: 20,
    });

    await setCache(cacheKey, productTypes, 300);

    return res.status(200).json(
      successOptionResponse(
        "Product types fetched from product mirror",
        productTypes,
      ),
    );
  } catch (error) {
    await logApiError({
      shop,
      err: error,
      req,
      source: "GET /api/products/product-type-all",
    });

    return res.status(500).json(errorResponse("Failed to fetch product types"));
  }
});

export const getProductFilterValues = asyncHandler(async (req, res) => {
  const { shop } = getSessionShop(res);
  const field = normalizeFieldParam(req.params.field);
  const search = normalizeSearch(req.query.search);

  try {
    const data = await productService.getDistinctProductFilterValues({
      shop,
      field,
      search,
      take: 20,
    });

    return res
      .status(200)
      .json(successOptionResponse("Product filter values fetched successfully", data));
  } catch (error) {
    await logApiError({
      shop,
      err: error,
      req,
      source: `GET /api/products/filter-values/${field}`,
    });

    return res
      .status(500)
      .json(errorResponse("Failed to fetch product filter values"));
  }
});
