import { productFilterService } from "../services/productService/productFilterService.js";
import { productMirrorRepository } from "../repositories/productMirrorRepository.js";
import { successResponse, errorResponse } from "../utils/responseUtils.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getCache, setCache } from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { prisma } from "../config/database.js";
import { getStoreMirrorState } from "../services/mirrorHealthService.js";
import { stableHash } from "../utils/idempotencyKey.js";

function successOptionResponse(message, data) {
  return {
    success: true,
    message,
    count: Array.isArray(data) ? data.length : 0,
    data,
  };
}

const READY_MIRROR_STATES = new Set(["READY", "HEALTHY"]);
const MAX_FILTER_CLAUSES = 50;
const MAX_FILTER_BODY_BYTES = 64 * 1024;
const MAX_FILTER_QUERY_TAKE = 50;
const MAX_SEARCH_LENGTH = 80;
const MAX_QUERY_INFLIGHT_LOCK_SECONDS = 8;
const PRODUCT_QUERY_TIMEOUT_MS = 20_000;
const PRODUCT_QUERY_PAGE_LIMIT = 1000;
const ALLOWED_FILTER_VALUE_FIELDS = new Set([
  "vendor",
  "tag",
  "tags",
  "product_type",
  "category",
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
  "option_name_1",
  "option_name_2",
  "option_name_3",
  "option_value_1",
  "option_value_2",
  "option_value_3",
  "country_of_origin",
  "inventory_policy",
  "weight_unit",
]);

function normalizeFieldAlias(field) {
  if (field === "tags") return "tag";
  return field;
}

function sanitizeSearchTerm(value) {
  return String(value || "").trim().toLowerCase().slice(0, MAX_SEARCH_LENGTH);
}

function canonicalizeFilterParams(filterParams) {
  if (!Array.isArray(filterParams)) return [];
  return filterParams.slice(0, MAX_FILTER_CLAUSES).map((item) => {
    if (!item || typeof item !== "object") return {};
    const out = {};
    for (const key of Object.keys(item).sort()) {
      const value = item[key];
      if (value === undefined) continue;
      if (typeof value === "string") {
        out[key] = value.trim();
      } else {
        out[key] = value;
      }
    }
    return out;
  });
}

function encodeCursorToken({ id, mirrorBatchId }) {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      id: String(id || ""),
      mb: String(mirrorBatchId || ""),
    }),
    "utf8",
  ).toString("base64url");
}

function decodeCursorToken(token) {
  if (!token || typeof token !== "string") return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(token, "base64url").toString("utf8"),
    );
    const id = String(parsed?.id || "").trim();
    const mirrorBatchId = String(parsed?.mb || "").trim();
    if (!id || !mirrorBatchId) return null;
    return { id, mirrorBatchId };
  } catch {
    return null;
  }
}

async function acquireProductQueryInflightLock(shop, queryHash) {
  const key = `${shop}:ProductQueryInflight:${queryHash}`;
  const existing = await getCache(key);
  if (existing) {
    return { acquired: false, key };
  }
  await setCache(key, "1", MAX_QUERY_INFLIGHT_LOCK_SECONDS);
  return { acquired: true, key };
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

    const mirrorState = await getStoreMirrorState(session.shop);
    const mirrorStateValue = String(
      mirrorState?.state || mirrorState?.mirrorHealthState || "",
    ).toUpperCase();

    if (!READY_MIRROR_STATES.has(mirrorStateValue)) {
      return res
        .status(409)
        .json(errorResponse("MIRROR_NOT_READY", { mirrorHealth: mirrorState }));
    }

    const take = Math.min(
      Math.max(Number(req.query?.limit || req.query?.take) || 50, 1),
      MAX_FILTER_QUERY_TAKE,
    );
    const page = Math.max(Number(req.query?.page) || 1, 1);
    if (page > PRODUCT_QUERY_PAGE_LIMIT) {
      return res.status(400).json(errorResponse("PAGE_LIMIT_EXCEEDED"));
    }

    const rawCursor =
      typeof req.query?.cursor === "string" && req.query.cursor.trim()
        ? req.query.cursor.trim()
        : null;
    const decodedCursor = decodeCursorToken(rawCursor);
    if (rawCursor && !decodedCursor) {
      return res.status(400).json(errorResponse("INVALID_CURSOR"));
    }
    if (page > 1 && !decodedCursor) {
      return res.status(400).json(errorResponse("CURSOR_REQUIRED_FOR_PAGE_GT_1"));
    }
    if (decodedCursor && decodedCursor.mirrorBatchId !== mirrorState?.activeMirrorBatchId) {
      return res.status(409).json(errorResponse("CURSOR_MIRROR_BATCH_MISMATCH"));
    }

    const filterParams = canonicalizeFilterParams(req.body?.filterParams || []);
    if (
      (Array.isArray(filterParams) && filterParams.length > MAX_FILTER_CLAUSES) ||
      Buffer.byteLength(JSON.stringify(filterParams || []), "utf8") >
        MAX_FILTER_BODY_BYTES
    ) {
      return res.status(400).json(
        errorResponse("FILTER_COMPLEXITY_LIMIT_EXCEEDED", {
          maxClauses: MAX_FILTER_CLAUSES,
          maxBytes: MAX_FILTER_BODY_BYTES,
        }),
      );
    }

    const queryHash = stableHash({
      shop: session.shop,
      take,
      cursor: decodedCursor?.id || null,
      mirrorBatchId: mirrorState?.activeMirrorBatchId || null,
      filterParams,
    });
    const inflight = await acquireProductQueryInflightLock(session.shop, queryHash);
    if (!inflight.acquired) {
      return res.status(429).json(errorResponse("PRODUCT_QUERY_IN_PROGRESS"));
    }

    const result = await Promise.race([
      productFilterService.getProductsWithFilters({
        queryParams: {
          ...req.query,
          take,
          limit: take,
          page,
          cursor: decodedCursor?.id || null,
          sortKey: "ID",
          sortOrder: "asc",
          mirrorBatchId: mirrorState?.activeMirrorBatchId || null,
        },
        filterParams,
        shop: session.shop,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("PRODUCT_QUERY_TIMEOUT")), PRODUCT_QUERY_TIMEOUT_MS),
      ),
    ]);
    if (result?.mirrorBatchId && result.mirrorBatchId !== mirrorState?.activeMirrorBatchId) {
      return res.status(409).json(errorResponse("MIRROR_BATCH_DRIFT_DETECTED"));
    }

    const nextCursorToken =
      result?.pagination?.nextCursor && result?.mirrorBatchId
        ? encodeCursorToken({
            id: result.pagination.nextCursor,
            mirrorBatchId: result.mirrorBatchId,
          })
        : null;
    const sanitizedResult = {
      ...result,
      pagination: {
        ...(result?.pagination || {}),
        cursor: rawCursor || null,
        nextCursorToken,
      },
    };

    if (process.env.NODE_ENV === "production") {
      const trackKey = `${session.shop}:filter_track:${queryHash}`;
      const recentlyTracked = await getCache(trackKey);
      if (!recentlyTracked) {
        await setCache(trackKey, "1", 10);
        prisma.filterTrack.create({
        data: {
          shop: session.shop,
          filterParams,
          respondProductCount: result?.count || 0,
          type: "filter",
        },
      }).catch((trackError) => {
        logApiError({
          shop: session.shop,
          err: trackError,
          req,
          source: "filterTrack.create",
        }).catch(() => {});
      });
      }
    }

    return res.status(200).json(
      successResponse("Products fetched successfully", {
        ...sanitizedResult,
        mirrorHealth: mirrorState,
      })
    );
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "GET /api/products",
    });

    if (err?.message === "PRODUCT_QUERY_TIMEOUT") {
      return res.status(503).json(errorResponse("PRODUCT_QUERY_TIMEOUT"));
    }

    return res.status(500).json(errorResponse("Failed to fetch products"));
  }
};

export const checkEditStatus = asyncHandler(async (req, res) => {
  const session = res.locals.shopify?.session;
  const id = req.params.id;

  if (!session?.shop) {
    return res.status(403).json(errorResponse("Session expired"));
  }

  const history = await prisma.editHistory.findFirst({
    where: {
      id,
      shop: session.shop,
    },
    select: {
      status: true,
      executionState: true,
      failureStage: true,
      error: true,
      processedCount: true,
      totalItems: true,
      durationMs: true,
    },
  });

  if (history) {
    return res.status(200).json({
      status: history.status,
      stage: history.executionState || history.failureStage || null,
      errorMessage: history.error?.message || null,
      rootObjectCount: history.processedCount,
      totalItems: history.totalItems,
      duration: history.durationMs,
    });
  }

  return res.status(404).json({
    error: "EDIT_HISTORY_NOT_FOUND",
    message: "No history found",
  });
});

export const getProductMirrorDetail = asyncHandler(async (req, res) => {
  const session = res.locals.shopify?.session;
  if (!session?.shop) {
    return res.status(403).json(errorResponse("Session expired"));
  }

  const productId = String(req.params.id || "").trim();
  if (!productId) {
    return res.status(400).json(errorResponse("PRODUCT_ID_REQUIRED"));
  }

  const mirrorState = await getStoreMirrorState(session.shop);
  const mirrorBatchId = mirrorState?.activeMirrorBatchId || null;
  if (!mirrorBatchId) {
    return res.status(409).json(errorResponse("MIRROR_NOT_READY"));
  }

  const product = await productMirrorRepository.findProductDetail({
    shop: session.shop,
    productId,
    mirrorBatchId,
  });

  if (!product) {
    return res.status(404).json(errorResponse("PRODUCT_NOT_FOUND"));
  }

  return res.status(200).json(
    successResponse("Product detail fetched successfully", {
      product,
      mirrorBatchId,
    }),
  );
});

export const getProductTypes = async (req, res) => {
  try {
    const rawSearch = typeof req.query.search === "string" ? req.query.search : "";
    const search = sanitizeSearchTerm(rawSearch);
    const session = res.locals.shopify?.session;

    if (!session?.shop) {
      return res.status(401).json({ message: "Shopify session missing" });
    }

    const shop = session.shop;
    const normalizedSearch = search;
    const cacheKey = `${shop}:productTypes:${stableHash({ q: normalizedSearch, v: 1 })}`;
    const cached = await getCache(cacheKey);

    if (cached) {
      return res
        .status(200)
        .json(
          successOptionResponse("Product types fetched from cache", cached)
        );
    }

    const productTypes =
      await productFilterService.getDistinctProductFilterValues({
        shop,
        field: "product_type",
        search: normalizedSearch,
        take: Math.min(Number(req.query?.take) || 20, MAX_FILTER_QUERY_TAKE),
      });

    await setCache(cacheKey, productTypes, 300);

    return res
      .status(200)
      .json(
        successOptionResponse(
          "Product types fetched from product mirror",
          productTypes
        )
      );
  } catch (error) {
    await logApiError({
      shop: res.locals.shopify?.session?.shop,
      err: error,
      req,
      source: "productController.getProductTypes",
    });

    return res.status(500).json({
      error: "PRODUCT_TYPES_FETCH_FAILED",
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

    const rawField = String(req.params.field || "").trim();
    if (!ALLOWED_FILTER_VALUE_FIELDS.has(rawField)) {
      return res.status(400).json({
        error: "INVALID_FILTER_FIELD",
        message: "Unsupported filter field",
      });
    }

    const field = normalizeFieldAlias(rawField);
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const normalizedSearch = sanitizeSearchTerm(search);
    const cacheKey = `${session.shop}:ProductFilterValues:${field}:${stableHash({
      q: normalizedSearch,
      v: 1,
    })}`;

    const cached = await getCache(cacheKey);
    if (cached) {
      return res
        .status(200)
        .json(
          successOptionResponse("Product filter values fetched from cache", cached)
        );
    }

    const data = await productFilterService.getDistinctProductFilterValues({
      shop: session.shop,
      field,
      search: normalizedSearch,
      take: Math.min(Number(req.query?.take) || 20, MAX_FILTER_QUERY_TAKE),
    });

    await setCache(cacheKey, data, 300);

    return res
      .status(200)
      .json(
        successOptionResponse(
          "Product filter values fetched successfully",
          data
        )
      );
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "productController.getProductFilterValues",
    });

    return res.status(400).json({
      error: "PRODUCT_FILTER_VALUES_FETCH_FAILED",
      message: "Failed to fetch product filter values",
    });
  }
};
