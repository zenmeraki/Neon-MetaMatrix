import { Services } from "../services/productService/productFilterService.js";
import { successResponse, errorResponse } from "../utils/responseUtils.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getCache, setCache } from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { prisma } from "../config/database.js";

const productService = new Services();

/**
 * GET /api/products
 * Product listing with filters (still backed by your Mongo/PG filter engine in Services)
 * Only tracking (FilterTrack) is converted to Prisma here.
 */
export const getProductsWithQuery = async (req, res) => {
  const session = res.locals.shopify?.session;

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const result = await productService.getProductsWithFilters({
      queryParams: req.query,
      filterParams: req.body.filterParams,
      shop: session.shop,
    });

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
      .json(successResponse("Products fetched successfully", result));
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
      return res.status(200).json({
        data: cached,
        message: "Product types fetched from cache",
      });
    }

    // Prisma equivalent of aggregate-distinct productType
    const result = await prisma.product.findMany({
      where: {
        shop,
        NOT: [{ productType: null }, { productType: "" }],
        ...(search
          ? {
              productType: {
                contains: search,
                mode: "insensitive",
              },
            }
          : {}),
      },
      select: {
        productType: true,
      },
      distinct: ["productType"],
      orderBy: {
        productType: "asc",
      },
      take: 20,
    });

    const productTypes = result.map((r) => ({ title: r.productType }));

    await setCache(cacheKey, productTypes, 300);

    return res.status(200).json({
      data: productTypes,
      message: "Product types fetched from product mirror",
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      message: "Failed to fetch product types",
    });
  }
};
