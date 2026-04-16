// web/controllers/collectionController.js
import Joi from "joi";
import logger from "../utils/loggerUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { adminGraphqlWithRetry } from "../utils/shopifyAdminApi.js";

const COLLECTION_SELECTOR_LIMIT_MAX = 50;

const getAllCollectionsQuerySchema = Joi.object({
  search: Joi.string().trim().allow("").max(100).optional(),
  limit: Joi.number()
    .integer()
    .min(1)
    .max(COLLECTION_SELECTOR_LIMIT_MAX)
    .default(20)
    .optional(),
});

function successEnvelope(message, data, meta = null) {
  return {
    success: true,
    message,
    data,
    count: Array.isArray(data) ? data.length : 0,
    ...(meta ? { meta } : {}),
  };
}

function errorEnvelope(error, message) {
  return {
    success: false,
    error,
    message,
  };
}

function mapCollectionOptions(collections = []) {
  return Array.isArray(collections)
    ? collections
        .filter((item) => item?.title)
        .map((item) => ({
          label: item.title,
          value: item.shopifyId || item.id,
          title: item.title,
          id: item.shopifyId || item.id,
        }))
    : [];
}

function buildShopifyCollectionTitleQuery(searchText) {
  const normalized = String(searchText || "")
    .normalize("NFKC")
    .replace(/[\\"]/g, "\\$&")
    .replace(/[:(){}[\]^~*?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized ? `title:${JSON.stringify(`${normalized}*`)}` : "";
}

export const getAllCollection =
  (collectionService) => async (req, res) => {
    const session = res.locals?.shopify?.session;

    try {
      const { error, value } = getAllCollectionsQuerySchema.validate(req.query);
      if (error) {
        return res
          .status(400)
          .json(errorEnvelope("INVALID_COLLECTION_QUERY", "Invalid collection query"));
      }

      if (!session?.shop) {
        return res
          .status(401)
          .json(errorEnvelope("AUTH_REQUIRED", "Shopify session missing"));
      }

      const searchText = value.search?.trim() || "";

      const result = await collectionService.fetchCollections(
        session,
        searchText,
        value.limit,
      );

      if (result?.syncRequired) {
        return res.status(202).json(
          successEnvelope(result.message || "No active catalog snapshot", [], {
            source: "mirror",
            syncRequired: true,
            ...(result.meta || {}),
          }),
        );
      }

      const data = mapCollectionOptions(result?.data);

      return res.status(200).json(
        successEnvelope("Collections fetched successfully", data, {
          source: "mirror",
          detail: result?.message || null,
        }),
      );
    } catch (error) {
      logger.error(error, {
        shop: session?.shop,
        source: "collectionController.getAllCollection",
      });
      await logApiError({
        shop: session?.shop,
        err: error,
        req,
        source: "collectionController.getAllCollection",
      });

      return res
        .status(500)
        .json(errorEnvelope("COLLECTIONS_FETCH_FAILED", "Failed to get collections"));
    }
  };

export const getCollectionsFromShopify = async (req, res) => {
  const session = res.locals?.shopify?.session;

  try {
    const { error, value } = getAllCollectionsQuerySchema.validate(req.query);
    if (error) {
      return res
        .status(400)
        .json(errorEnvelope("INVALID_COLLECTION_QUERY", "Invalid collection query"));
    }

    if (!session?.shop) {
      return res
        .status(401)
        .json(errorEnvelope("AUTH_REQUIRED", "Shopify session missing"));
    }

    const searchText = value.search?.trim() || "";
    const first = value.limit;
    const queryString = buildShopifyCollectionTitleQuery(searchText);

    const QUERY = `
      query GetCollections($first: Int!, $query: String) {
        collections(first: $first, query: $query) {
          edges {
            node {
              id
              title
            }
          }
        }
      }
    `;

    const response = await adminGraphqlWithRetry({
      session,
      shop: session?.shop,
      operationName: "getCollectionsFromShopify",
      data: {
        query: QUERY,
        variables: {
          first,
          query: queryString || null,
        },
      },
    });

    const graphQLErrors = response?.body?.errors;
    if (Array.isArray(graphQLErrors) && graphQLErrors.length > 0) {
      const error = new Error("Shopify collections query returned errors");
      error.details = graphQLErrors;
      throw error;
    }

    const edges = response?.body?.data?.collections?.edges || [];
    const collections = edges.map((edge) => ({
      id: edge.node.id,
      title: edge.node.title,
    }));

    return res.status(200).json(
      successEnvelope("Collections fetched from Shopify", collections, {
        source: "live_shopify",
        contract:
          "Live Shopify collection reads are for repair/admin flows; mirror reads remain canonical for filter values.",
      }),
    );
  } catch (error) {
    logger.error(error, {
      shop: session?.shop,
      source: "collectionController.getCollectionsFromShopify",
    });
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "collectionController.getCollectionsFromShopify",
    });

    return res
      .status(500)
      .json(errorEnvelope("COLLECTIONS_FETCH_FAILED", "Failed to get collections"));
  }
};

export const clearCollections =
  (collectionService) => async (req, res) => {
    const session = res.locals?.shopify?.session;

    try {
      if (!session?.shop) {
        return res
          .status(401)
          .json(errorEnvelope("AUTH_REQUIRED", "Shopify session missing"));
      }

      const result = await collectionService.clearCollections(session);

      return res.status(200).json(
        successEnvelope("Collections refreshed successfully", result, {
          source: "collection_sync",
        }),
      );
    } catch (error) {
      logger.error(error, {
        shop: session?.shop,
        source: "collectionController.clearCollections",
      });
      await logApiError({
        shop: session?.shop,
        err: error,
        req,
        source: "collectionController.clearCollections",
      });

      return res
        .status(500)
        .json(errorEnvelope("COLLECTION_REFRESH_FAILED", "Failed to clear collections"));
    }
  };
