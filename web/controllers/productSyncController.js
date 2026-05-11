import { asyncHandler } from "../utils/asyncHandler.js";
import { clearKeyCachesBatch, getCache, getRedisClient, setCache } from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { adminGraphqlWithRetry } from "../utils/shopifyAdminApi.js";
import shopify from "../shopify.js";
import crypto from "crypto";
import { prisma } from "../config/database.js";
import { classifyRetry } from "../utils/errorTaxonomy.js";
import { addProductTypeRefreshJob } from "../jobs/queues/productTypeRefreshQueue.js";
import {
  acquireRedisLock,
  refreshRedisLock,
  releaseRedisLock,
} from "../services/productService/productTypeRefreshLockService.js";

const PRODUCT_TYPES_QUERY = `#graphql
  query ProductTypes($first: Int!, $after: String) {
    productTypes(first: $first, after: $after) {
      edges {
        node
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const PRODUCT_TYPES_PAGE_SIZE = 250;
const PRODUCT_TYPES_MAX_PAGES = 1000;
const PRODUCT_TYPES_REFRESH_LOCK_TTL_SECONDS = 90;
const PRODUCT_TYPES_REFRESH_HEARTBEAT_SECONDS = 25;
const PRODUCT_TYPES_CACHE_TTL_SECONDS = 6 * 60 * 60;
const PRODUCT_TYPES_REFRESH_FRESH_MS = 10 * 60 * 1000;
const PRODUCT_TYPES_ASYNC_THRESHOLD = Math.max(
  Number(process.env.PRODUCT_TYPES_ASYNC_THRESHOLD || 50000),
  5000,
);

function buildProductTypesKeys(shop) {
  return {
    lock: `${shop}:lock:refresh_product_types`,
    data: `${shop}:productTypes:catalog`,
    meta: `${shop}:productTypes:catalog:meta`,
  };
}

export const __testables = {
  acquireRedisLock,
  refreshRedisLock,
  releaseRedisLock,
};

async function fetchAllProductTypes(session) {
  const productTypes = new Set();
  let after = null;
  let page = 0;

  while (true) {
    page += 1;
    if (page > PRODUCT_TYPES_MAX_PAGES) {
      throw new Error("Product types pagination exceeded safety limit");
    }

    const response = await adminGraphqlWithRetry({
      session,
      shop: session.shop,
      operationName: "ProductTypes",
      data: {
        query: PRODUCT_TYPES_QUERY,
        variables: {
          first: PRODUCT_TYPES_PAGE_SIZE,
          after,
        },
      },
    });

    const topLevelErrors = response.body?.errors;
    if (Array.isArray(topLevelErrors) && topLevelErrors.length > 0) {
      throw new Error(topLevelErrors[0].message || "Failed to fetch product types");
    }

    const connection = response.body?.data?.productTypes;
    if (!connection) {
      throw new Error("Shopify productTypes query returned no data");
    }

    for (const edge of connection.edges || []) {
      const value = String(edge?.node || "").trim();
      if (value) {
        productTypes.add(value);
      }
    }

    if (!connection.pageInfo?.hasNextPage) {
      break;
    }

    after = connection.pageInfo.endCursor || null;
    if (!after) {
      break;
    }
  }

  return [...productTypes].sort((a, b) => a.localeCompare(b));
}

async function resolveActiveSessionForShop(session, shop) {
  if (
    session?.shop === shop &&
    session?.accessToken &&
    typeof session?.isActive === "function" &&
    session.isActive(shopify.api.config.scopes)
  ) {
    return session;
  }

  const loadSession = shopify?.config?.sessionStorage?.loadSession;
  const getOfflineId = shopify?.api?.session?.getOfflineId;
  if (typeof loadSession !== "function" || typeof getOfflineId !== "function") {
    throw new Error("Shopify session storage is not configured");
  }

  const offlineSession = await loadSession.call(
    shopify.config.sessionStorage,
    getOfflineId(shop),
  );

  if (
    !offlineSession?.accessToken ||
    offlineSession.shop !== shop ||
    (typeof offlineSession.isActive === "function" &&
      !offlineSession.isActive(shopify.api.config.scopes))
  ) {
    throw new Error(`Active Shopify session not found for shop: ${shop}`);
  }

  return offlineSession;
}

export async function refreshProductTypesForShop({ shop, force = false, session = null, req = null }) {
  const keys = buildProductTypesKeys(shop);
  const lockToken = crypto.randomUUID();
  const redis = getRedisClient();
  let heartbeat = null;

  try {
    if (!shop) {
      const error = new Error("Shopify session invalid");
      error.statusCode = 401;
      throw error;
    }

    const lockAcquired = await acquireRedisLock(
      redis,
      keys.lock,
      lockToken,
      PRODUCT_TYPES_REFRESH_LOCK_TTL_SECONDS,
    );
    if (!lockAcquired) {
      const error = new Error("PRODUCT_TYPES_REFRESH_RUNNING");
      error.statusCode = 409;
      throw error;
    }

    heartbeat = setInterval(async () => {
      try {
        await refreshRedisLock(
          redis,
          keys.lock,
          lockToken,
          PRODUCT_TYPES_REFRESH_LOCK_TTL_SECONDS,
        );
      } catch {
        // best effort
      }
    }, PRODUCT_TYPES_REFRESH_HEARTBEAT_SECONDS * 1000);

    const cachedMeta = await getCache(keys.meta);
    if (!force && cachedMeta?.refreshedAt) {
      const refreshedAtMs = new Date(cachedMeta.refreshedAt).getTime();
      if (Number.isFinite(refreshedAtMs) && Date.now() - refreshedAtMs < PRODUCT_TYPES_REFRESH_FRESH_MS) {
        const cachedTypes = (await getCache(keys.data)) || [];
        return {
          success: true,
          message: "Product types already fresh",
          count: Array.isArray(cachedTypes) ? cachedTypes.length : 0,
          data: Array.isArray(cachedTypes) ? cachedTypes : [],
          refreshedAt: cachedMeta.refreshedAt,
          statusCode: 200,
        };
      }
    }

    await prisma.store.updateMany({
      where: { shopUrl: shop },
      data: {
        isProductTypeSyncing: true,
      },
    });

    const activeSession = await resolveActiveSessionForShop(session, shop);
    const productTypes = await fetchAllProductTypes(activeSession);
    const refreshedAt = new Date().toISOString();

    await Promise.all([
      setCache(keys.data, productTypes, PRODUCT_TYPES_CACHE_TTL_SECONDS),
      setCache(
        keys.meta,
        { refreshedAt, count: productTypes.length },
        PRODUCT_TYPES_CACHE_TTL_SECONDS,
      ),
      prisma.store.updateMany({
        where: { shopUrl: shop },
        data: {
          isProductTypeSyncing: false,
          lastProductTypeSyncAt: new Date(),
        },
      }),
    ]);

    await clearKeyCachesBatch([
      `${shop}:productTypes:`,
      `${shop}:ProductFilterValues:product_type:`,
      `${shop}:filterFacets:product_type`,
    ]);

    return {
      success: true,
      message: "Product types refreshed successfully",
      count: productTypes.length,
      data: productTypes,
      refreshedAt,
      statusCode: 200,
    };
  } catch (error) {
    await prisma.store.updateMany({
      where: { shopUrl: shop || "" },
      data: { isProductTypeSyncing: false },
    }).catch(() => {});

    if (req) {
      await logApiError({
        shop,
        err: error,
        req,
        source: "productSyncController.refreshProductTypes",
      });
    }

    throw error;
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
    if (shop) {
      await releaseRedisLock(redis, keys.lock, lockToken).catch(() => {});
    }
  }
}

export const refreshProductTypes = asyncHandler(async (req, res) => {
  const session = res.locals?.shopify?.session;
  const shop = session?.shop;
  const force = String(req.query?.force || "").trim().toLowerCase() === "true";

  if (
    !session?.shop ||
    !session?.accessToken ||
    (typeof session.isActive === "function" &&
      !session.isActive(shopify.api.config.scopes))
  ) {
    return res.status(401).json({ error: "Shopify session invalid" });
  }

  const store = await prisma.store.findUnique({
    where: { shopUrl: shop },
    select: { storeTotalProducts: true },
  });

  if (Number(store?.storeTotalProducts || 0) >= PRODUCT_TYPES_ASYNC_THRESHOLD) {
    const job = await addProductTypeRefreshJob(
      { shop, force },
      { jobId: `product-type-refresh:${shop}` },
    );
    return res.status(202).json({
      success: true,
      accepted: true,
      message: "Product type refresh queued",
      jobId: job?.id || null,
      threshold: PRODUCT_TYPES_ASYNC_THRESHOLD,
    });
  }

  try {
    const response = await refreshProductTypesForShop({ shop, force, session, req });
    return res.status(response.statusCode || 200).json(response);
  } catch (error) {
    const code = error?.message || error?.code || "PRODUCT_TYPES_REFRESH_FAILED";
    const retryClass = classifyRetry(code);
    if (code === "PRODUCT_TYPES_REFRESH_RUNNING") {
      return res.status(409).json({
        success: false,
        error: code,
        message: "Product type refresh is already running",
        retryClass,
      });
    }
    return res.status(Number(error?.statusCode) || 500).json({
      error: "PRODUCT_TYPES_REFRESH_FAILED",
      message: "Unable to refresh product types right now",
      retryClass,
    });
  }
});
