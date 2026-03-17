// web/controllers/collectionController.js
import Joi from "joi";
import { getCurrentBulkOperationStatus } from "../utils/bulkOperationHelper.js";
import logger from "../utils/loggerUtils.js";
import { clearKeyCaches } from "../utils/cacheUtils.js";
import shopify from "../shopify.js";
import { logApiError } from "../utils/errorLogUtils.js";

// ⛔️ REMOVE this:
// import Store from "../schema/Store.js";

// ✅ ADD Prisma
import { prisma } from "../config/database.js";


// ✅ Validate query param "search"
const getAllCollectionsQuerySchema = Joi.object({
  search: Joi.string().trim().allow("").max(100).optional(),
  isNameOnly: Joi.string().trim().allow("").max(100).optional(),
});

export const getAllCollection =
  (collectionService) => async (req, res, next) => {
    try {
      const { error, value } = getAllCollectionsQuerySchema.validate(req.query);
      if (error) {
        return res.status(400).json({
          error: `Invalid query: ${error.details[0].message}`,
        });
      }

      const session = res.locals.shopify.session;

      const searchText = value.search?.trim() || "";

      const result = await collectionService.fetchCollections(
        session,
        searchText,
      );
      return res.status(200).json(result);
    } catch (error) {
      logger.error("Failed to get collections", { error: error.message });
      return res.status(500).json({
        error: error.message,
        message: "Failed to get collections",
      });
    }
  };

export const getCollectionsFromShopify = async (req, res) => {
  const session = res.locals.shopify.session;
  try {
    const { error, value } = getAllCollectionsQuerySchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        error: `Invalid query: ${error.details[0].message}`,
      });
    }

    const searchText = value.search?.trim() || "";
    const first = value.limit || 20;

    // Build query string
    const queryString = searchText ? `title:${searchText}*` : "";

    const client = new shopify.api.clients.Graphql({ session });

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

    const response = await client.query({
      data: {
        query: QUERY,
        variables: {
          first,
          query: queryString || null,
        },
      },
    });

    const collections = response.body.data.collections.edges.map((edge) => ({
      id: edge.node.id,
      title: edge.node.title,
    }));

    return res.status(200).json({
      success: true,
      count: collections.length,
      data: collections,
    });
  } catch (error) {
    logger.error("Failed to get collections", {
      error: error.message,
    });
    await logApiError({
      shop: session.shop,
      err: error,
      req,
      source: "collectionController.getCollectionsFromShopify",
    });

    return res.status(500).json({
      error: error.message,
      message: "Failed to get collections",
    });
  }
};

export const clearCollections =
  (collectionService) => async (req, res, next) => {
    try {
      const session = res.locals.shopify.session;

      const { status } = await getCurrentBulkOperationStatus(session, "QUERY");
      if (status === "RUNNING") {
        return res.status(400).json({
          message: "Another operation is running in background",
        });
      }

      const result = await collectionService.clearCollections(session);

      // 🔁 Mongo → Prisma: update flattened sync fields
      const store = await prisma.store.update({
        where: { shopUrl: session.shop },
        data: {
          isCollectionSyncing: true,
          lastCollectionSyncAt: new Date(),
        },
      });

      if (!store) {
        // In practice prisma.update would throw if not found
        return res.status(404).json({
          error: "Store not found",
        });
      }

      // 🧹 Clear cached sync details after updating DB
      await clearKeyCaches(`${session.shop}:sync_details`);

      return res.status(200).json({
        message: "Collections refreshed successfully",
        result,
      });
    } catch (error) {
      logger.error("Failed to clear collections", { error: error.message });
      return res.status(500).json({ error: "Failed to clear collections" });
    }
  };