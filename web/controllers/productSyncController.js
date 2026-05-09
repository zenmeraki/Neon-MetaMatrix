import { asyncHandler } from "../utils/asyncHandler.js";
import { clearKeyCaches, getCache, setCache } from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { adminGraphqlWithRetry } from "../utils/shopifyAdminApi.js";
import shopify from "../shopify.js";

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
const PRODUCT_TYPES_REFRESH_LOCK_TTL_SECONDS = 60;

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

export const refreshProductTypes = asyncHandler(async (req, res) => {
  const session = res.locals?.shopify?.session;
  const lockKey = `${session?.shop}:lock:refresh_product_types`;

  try {
    if (
      !session?.shop ||
      !session?.accessToken ||
      (typeof session.isActive === "function" &&
        !session.isActive(shopify.api.config.scopes))
    ) {
      return res.status(401).json({ error: "Shopify session invalid" });
    }

    const existingLock = await getCache(lockKey);
    if (existingLock) {
      return res.status(409).json({
        success: false,
        error: "PRODUCT_TYPES_REFRESH_RUNNING",
        message: "Product type refresh is already running",
      });
    }

    await setCache(lockKey, "1", PRODUCT_TYPES_REFRESH_LOCK_TTL_SECONDS);

    const productTypes = await fetchAllProductTypes(session);

    await Promise.all([
      clearKeyCaches(`${session.shop}:productTypes:`),
      clearKeyCaches(`${session.shop}:ProductFilterValues:product_type`),
      clearKeyCaches(`${session.shop}:ProductFilterValues:product_type:`),
      clearKeyCaches(`${session.shop}:filterFacets:product_type`),
      clearKeyCaches(`${session.shop}:filters:`),
    ]);

    return res.status(200).json({
      success: true,
      message: "Product types refreshed successfully",
      count: productTypes.length,
      data: productTypes,
    });
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "productSyncController.refreshProductTypes",
    });

    return res.status(500).json({
      error: "PRODUCT_TYPES_REFRESH_FAILED",
      message: "Unable to refresh product types right now",
    });
  } finally {
    if (session?.shop) {
      await clearKeyCaches(lockKey);
    }
  }
});
