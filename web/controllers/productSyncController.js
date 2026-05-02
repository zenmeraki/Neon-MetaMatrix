import { asyncHandler } from "../utils/asyncHandler.js";
import { clearKeyCaches } from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
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

async function fetchAllProductTypes(session) {
  const client = new shopify.api.clients.Graphql({ session });
  const productTypes = new Set();
  let after = null;

  while (true) {
    const response = await client.query({
      data: {
        query: PRODUCT_TYPES_QUERY,
        variables: {
          first: 250,
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

  try {
    if (!session?.shop) {
      return res.status(401).json({ error: "Shopify session missing" });
    }

    const productTypes = await fetchAllProductTypes(session);

    await clearKeyCaches(`${session.shop}:productTypes:`);
    await clearKeyCaches(`${session.shop}:ProductFilterValues:product_type`);

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
      error: "Failed to refresh product types",
      message: error.message,
    });
  }
});
