import { productFilterService } from "../services/productService/productFilterService.js";
import { successResponse, errorResponse } from "../utils/responseUtils.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getCache, setCache } from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { prisma } from "../config/database.js";
import { getStoreMirrorState } from "../services/mirrorHealthService.js";

function successOptionResponse(message, data) {
  return {
    success: true,
    message,
    count: Array.isArray(data) ? data.length : 0,
    data,
  };
}

/**
 * GET /api/products
 * Product listing with filters backed by the product filter/query services.
 * Only tracking (FilterTrack) is converted to Prisma here.
 */
export const getProductsWithQuery = async (req, res) => {
  const session = res.locals.shopify?.session;

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const result = await productFilterService.getProductsWithFilters({
      queryParams: req.query,
      filterParams: req.body.filterParams,
      shop: session.shop,
    });
    const mirrorState = await getStoreMirrorState(session.shop);

    if (process.env.NODE_ENV === "production") {
      await prisma.filterTrack.create({
        data: {
          shop: session.shop,
          filterParams: req.body?.filterParams || {},
          respondProductCount: result?.count || 0,
          type: "filter",
        },
      });
    }

    return res
      .status(200)
      .json(successResponse("Products fetched successfully", {
        ...result,
        mirrorHealth: mirrorState,
      }));
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "GET /api/products",
    });

    return res.status(500).json(errorResponse("Failed to fetch products"));
  }
};

export const checkEditStatus = asyncHandler(async (req, res) => {
  const id = req.params.id;

  const history = await prisma.editHistory.findUnique({
    where: { id },
    select: {
      processedCount: true,
      totalItems: true,
      durationMs: true,
    },
  });

  if (history) {
    return res.status(200).json({
      rootObjectCount: history.processedCount,
      totalItems: history.totalItems,
      duration: history.durationMs,
    });
  }

  return res.status(200).json({
    status: "not_found",
    message: "No history found",
  });
});

export const getProductTypes = async (req, res) => {
  try {
    const { search = "" } = req.query;
    const session = res.locals.shopify?.session;

    if (!session?.shop) {
      return res.status(401).json({ message: "Shopify session missing" });
    }

    const shop = session.shop;
    const cacheKey = `${shop}:productTypes:${search.toLowerCase()}`;
    const cached = await getCache(cacheKey);

    if (cached) {
      return res
        .status(200)
        .json(successOptionResponse("Product types fetched from cache", cached));
    }

    const productTypes = await productFilterService.getDistinctProductFilterValues({
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
    return res.status(500).json({
      error: error.message,
      message: "Failed to fetch product types",
    });
  }
};

export const getProductFilterValues = async (req, res) => {
  const session = res.locals.shopify?.session;

  try {
    if (!session?.shop) {
      return res.status(401).json({ message: "Shopify session missing" });
    }

    const field = String(req.params.field || "").trim();
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";

    const data = await productFilterService.getDistinctProductFilterValues({
      shop: session.shop,
      field,
      search,
      take: 20,
    });

    return res
      .status(200)
      .json(successOptionResponse("Product filter values fetched successfully", data));
  } catch (error) {
    return res.status(400).json({
      error: error.message,
      message: "Failed to fetch product filter values",
    });
  }
};
