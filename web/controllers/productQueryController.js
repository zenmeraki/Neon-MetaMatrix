import { ProductFilterService } from "../services/productService/productFilterService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { logApiError } from "../utils/errorLogUtils.js";
import {
  getProductListing,
  isSupportedProductFilterValueField,
} from "../services/productService/productQueryService.js";
import { getEditStatusSummary } from "../services/editHistoryService.js";

const productService = new ProductFilterService();

function successEnvelope(message, data = null, meta = null) {
  return {
    success: true,
    message,
    data,
    ...(meta ? { meta } : {}),
  };
}

function errorEnvelope(error, message, data = null) {
  return {
    success: false,
    error,
    message,
    ...(data ? { data } : {}),
  };
}

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
}

async function getFilterOptionsPayload({ shop, field, search }) {
  const options = await productService.getDistinctProductFilterValues({
    shop,
    field,
    search,
    take: 20,
  });

  return {
    field,
    options,
    count: Array.isArray(options) ? options.length : 0,
  };
}

/**
 * POST /api/products/get-all
 * Product listing with filters. Complex filter ASTs are accepted from the POST body.
 */
export const getProductsWithQuery = async (req, res) => {
  const session = res.locals?.shopify?.session;

  try {
    if (!session) {
      return res
        .status(401)
        .json(errorEnvelope("AUTH_REQUIRED", "Shopify session missing"));
    }

    const result = await getProductListing({
      queryParams: req.query,
      filterParams: req.body?.filterParams || [],
      shop: session.shop,
    });

    return res
      .status(200)
      .json(successEnvelope("Products fetched successfully", result));
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/products/get-all",
    });

    return res
      .status(500)
      .json(errorEnvelope("PRODUCT_LIST_FAILED", "Failed to fetch products"));
  }
};

export const checkEditStatus = asyncHandler(async (req, res) => {
  const session = res.locals?.shopify?.session;
  const id = req.params.id;

  if (!session?.shop) {
    return res.status(401).json({
      ...errorEnvelope("AUTH_REQUIRED", "Shopify session missing"),
    });
  }

  const history = await getEditStatusSummary({
    id,
    shop: session.shop,
  });

  if (history) {
    return res.status(200).json(
      successEnvelope("Edit status fetched successfully", {
        status: "found",
        rootObjectCount: history.processedCount,
        totalItems: history.totalItems,
        duration: history.durationMs,
      }),
    );
  }

  return res
    .status(404)
    .json(errorEnvelope("EDIT_HISTORY_NOT_FOUND", "No history found", {
      status: "not_found",
    }));
});

export const getProductTypes = async (req, res) => {
  const session = res.locals?.shopify?.session;

  try {
    if (!session?.shop) {
      return res
        .status(401)
        .json(errorEnvelope("AUTH_REQUIRED", "Shopify session missing"));
    }

    const payload = await getFilterOptionsPayload({
      shop: session.shop,
      field: "product_type",
      search: normalizeSearch(req.query?.search),
    });

    return res.status(200).json(
      successEnvelope("Product types fetched successfully", payload),
    );
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "GET /api/products/product-type-all",
    });

    return res
      .status(500)
      .json(errorEnvelope("PRODUCT_TYPES_FAILED", "Failed to fetch product types"));
  }
};

export const getProductFilterValues = async (req, res) => {
  const session = res.locals?.shopify?.session;

  try {
    if (!session?.shop) {
      return res
        .status(401)
        .json(errorEnvelope("AUTH_REQUIRED", "Shopify session missing"));
    }

    const field = String(req.params.field || "").trim();
    if (!isSupportedProductFilterValueField(field)) {
      return res.status(400).json(
        errorEnvelope(
          "UNSUPPORTED_FILTER_FIELD",
          "Unsupported product filter field",
        ),
      );
    }

    const search = normalizeSearch(req.query?.search);

    const payload = await getFilterOptionsPayload({
      shop: session.shop,
      field,
      search,
    });

    return res.status(200).json(
      successEnvelope("Product filter values fetched successfully", payload),
    );
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "GET /api/products/filter-values/:field",
    });

    return res.status(500).json(
      errorEnvelope(
        "PRODUCT_FILTER_VALUES_FAILED",
        "Failed to fetch product filter values",
      ),
    );
  }
};
