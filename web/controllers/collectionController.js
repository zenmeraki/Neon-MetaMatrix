import crypto from "crypto";
import Joi from "joi";
import { getCurrentBulkOperationStatus } from "../modules/bulkOperations/bulkOperationHelper.js";
import logger from "../utils/loggerUtils.js";
import { clearKeyCaches } from "../utils/cacheUtils.js";
import shopify from "../shopify.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { prisma } from "../config/database.js";
import { collectionSyncRepository } from "../repositories/collectionSyncRepository.js";
import { productFilterService } from "../services/productService/productFilterService.js";
import { idempotentCommandService } from "../services/idempotentCommandService.js";
import { classifyRetry } from "../utils/errorTaxonomy.js";

const getAllCollectionsQuerySchema = Joi.object({
  search: Joi.string().trim().allow("").max(100).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  isNameOnly: Joi.string().trim().allow("").max(100).optional(),
});

function hasValidSession(session) {
  return Boolean(
    session?.shop &&
      session?.accessToken &&
      (typeof session.isActive !== "function" ||
        session.isActive(shopify.api.config.scopes)),
  );
}

function getRequestId(req) {
  return req?.headers?.["x-request-id"] || crypto.randomUUID();
}

function getIdempotencyKey(req) {
  const value = req?.headers?.["idempotency-key"];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function hasCollectionAccess(shop) {
  const subscription = await prisma.subscription.findUnique({
    where: { shop },
    select: { status: true },
  });
  return !subscription || !["CANCELLED", "EXPIRED"].includes(subscription.status);
}

export const getAllCollection =
  (collectionService) => async (req, res) => {
    const requestId = getRequestId(req);
    try {
      const { error, value } = getAllCollectionsQuerySchema.validate(req.query);
      if (error) {
        return res.status(400).json({
          error: `Invalid query: ${error.details[0].message}`,
          requestId,
        });
      }

      const session = res.locals.shopify.session;
      if (!hasValidSession(session)) {
        return res.status(401).json({ error: "Shopify session invalid", requestId });
      }

      const searchText = value.search?.trim() || "";
      const limit = Math.min(Number(value.limit) || 20, 100);
      const data = await productFilterService.getDistinctProductFilterValues({
        shop: session.shop,
        field: "collection",
        search: searchText,
        take: limit,
      });

      return res.status(200).json({
        success: true,
        requestId,
        count: data.length,
        message: "Collections fetched from mirror",
        data,
      });
    } catch (err) {
      logger.error("Failed to get collections", { error: err.message, requestId });
      return res.status(500).json({
        error: "COLLECTION_FETCH_FAILED",
        message: "Unable to fetch collections",
        requestId,
      });
    }
  };

export const getCollectionsFromShopify = async (req, res) => {
  const session = res.locals.shopify.session;
  const requestId = getRequestId(req);
  try {
    if (!hasValidSession(session)) {
      return res.status(401).json({ error: "Shopify session invalid", requestId });
    }

    const { error, value } = getAllCollectionsQuerySchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        error: `Invalid query: ${error.details[0].message}`,
        requestId,
      });
    }

    const searchText = value.search?.trim() || "";
    const take = Math.min(Number(value.limit) || 20, 100);
    const collections = await productFilterService.getDistinctProductFilterValues({
      shop: session.shop,
      field: "collection",
      search: searchText,
      take,
    });

    return res.status(200).json({
      success: true,
      requestId,
      count: collections.length,
      fetchedCount: collections.length,
      hasNextPage: false,
      endCursor: null,
      source: "mirror_db",
      data: collections,
    });
  } catch (err) {
    logger.error("Failed to get collections", {
      error: err.message,
      requestId,
    });
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "collectionController.getCollectionsFromShopify",
    });

    return res.status(500).json({
      error: "COLLECTION_FETCH_FAILED",
      message: "Unable to fetch collections",
      requestId,
    });
  }
};

export const clearCollections =
  (collectionService) => async (req, res) => {
    const session = res.locals.shopify.session;
    const requestId = getRequestId(req);
    const idempotencyKey = getIdempotencyKey(req);
    let leaseOwner = null;
    let command = null;
    try {
      if (!hasValidSession(session)) {
        return res.status(401).json({ error: "Shopify session invalid", requestId });
      }

      if (!(await hasCollectionAccess(session.shop))) {
        return res.status(403).json({
          error: "PLAN_BLOCKED",
          retryable: false,
          message: "Your current plan does not allow collection refresh",
          requestId,
        });
      }

      command = await idempotentCommandService.begin({
        shop: session.shop,
        operationType: "COLLECTION_REFRESH_COMMAND",
        idempotencyKey,
        resourceType: "SYNC_HISTORY",
      });
      if (command.enabled && !command.created) {
        if (command.row.status === "COMPLETED") {
          return res.status(200).json({
            success: true,
            requestId,
            idempotentReplay: true,
            syncHistoryId: command.row.resourceId || null,
            retryClass: classifyRetry("IDEMPOTENT_REPLAY_COMPLETED"),
          });
        }
        return res.status(409).json({
          error: "IDEMPOTENT_DUPLICATE_IN_PROGRESS",
          retryClass: classifyRetry("IDEMPOTENT_DUPLICATE_IN_PROGRESS"),
          requestId,
        });
      }

      const [queryOp, mutationOp, store] = await Promise.all([
        getCurrentBulkOperationStatus(session, "QUERY"),
        getCurrentBulkOperationStatus(session, "MUTATION"),
        prisma.store.findUnique({
          where: { shopUrl: session.shop },
          select: {
            isProductSyncing: true,
            isProductInitialySyning: true,
            syncProgressStage: true,
          },
        }),
      ]);

      if (queryOp?.status === "RUNNING" || mutationOp?.status === "RUNNING") {
        return res.status(409).json({
          error: "SHOPIFY_BULK_RUNNING",
          retryClass: classifyRetry("SHOPIFY_BULK_RUNNING"),
          retryable: true,
          message: "Another Shopify bulk operation is running",
          requestId,
        });
      }

      if (store?.isProductSyncing || store?.isProductInitialySyning) {
        return res.status(409).json({
          error: "ACTION_BLOCKED_ACTIVE_OPERATION",
          retryClass: classifyRetry("ACTION_BLOCKED_ACTIVE_OPERATION"),
          retryable: true,
          stage: store?.syncProgressStage || null,
          message: "Collection refresh is blocked while product sync is active",
          requestId,
        });
      }

      leaseOwner = crypto.randomUUID();
      const lock = await collectionSyncRepository.acquireLease({
        shop: session.shop,
        leaseOwner,
      });

      if (lock.count !== 1) {
        return res.status(409).json({
          error: "COLLECTION_SYNC_ALREADY_RUNNING",
          retryClass: classifyRetry("COLLECTION_SYNC_ALREADY_RUNNING"),
          retryable: true,
          message: "Collection refresh is already running",
          requestId,
        });
      }

      const result = await collectionService.clearCollections({
        shop: session.shop,
        session,
      });

      await Promise.all([
        clearKeyCaches(`${session.shop}:collections:`),
        clearKeyCaches(`${session.shop}:filterFacets:collection`),
        clearKeyCaches(`${session.shop}:ProductFilterValues:collection`),
        clearKeyCaches(`${session.shop}:filters:`),
        clearKeyCaches(`${session.shop}:sync_details`),
      ]);

      const payload = {
        success: true,
        requestId,
        message: "Collections refreshed successfully",
        bulkOperationId: result?.operationId || null,
        syncHistoryId: result?.syncHistoryId || null,
        result,
      };

      logger.info("Collection refresh started", {
        shop: session.shop,
        requestId,
        bulkOperationId: result?.operationId || null,
        syncHistoryId: result?.syncHistoryId || null,
      });

      await idempotentCommandService.complete({
        id: command?.row?.id || null,
        resourceId: result?.syncHistoryId || null,
      });

      return res.status(200).json(payload);
    } catch (err) {
      await idempotentCommandService
        .fail({ id: command?.row?.id || null, message: err.message })
        .catch(() => {});
      if (leaseOwner) {
        await collectionSyncRepository
          .releaseLease({ shop: session?.shop, leaseOwner })
          .catch(() => {});
      }
      logger.error("Failed to clear collections", {
        error: err.message,
        requestId,
      });
      await logApiError({
        shop: session?.shop,
        err,
        req,
        source: "collectionController.clearCollections",
      });
      return res.status(500).json({
        error: "COLLECTION_CLEAR_FAILED",
        message: "Unable to refresh collections",
        requestId,
      });
    }
  };

export const cancelCollectionsRefresh = async (req, res) => {
  const session = res.locals.shopify.session;
  const requestId = getRequestId(req);
  try {
    if (!hasValidSession(session)) {
      return res.status(401).json({ error: "Shopify session invalid", requestId });
    }

    const activeSync = await prisma.syncHistory.findFirst({
      where: {
        shop: session.shop,
        operationType: "Collection",
        status: "processing",
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        bulkOperationId: true,
        stage: true,
      },
    });

    if (!activeSync) {
      return res.status(200).json({
        success: true,
        requestId,
        status: "ALREADY_COMPLETED",
        message: "No active collection refresh found",
      });
    }

    if (activeSync.bulkOperationId) {
      return res.status(409).json({
        success: false,
        requestId,
        status: "CANCEL_NOT_POSSIBLE_SHOPIFY_SUBMITTED",
        retryClass: classifyRetry("CANCEL_NOT_POSSIBLE_SHOPIFY_SUBMITTED"),
        syncHistoryId: activeSync.id,
        bulkOperationId: activeSync.bulkOperationId,
        stage: activeSync.stage || null,
      });
    }

    await prisma.syncHistory.update({
      where: { id: activeSync.id },
      data: {
        status: "failed",
        errorMessage: "CANCEL_REQUESTED_BEFORE_SHOPIFY",
      },
    });

    await prisma.store.updateMany({
      where: { shopUrl: session.shop },
      data: {
        isCollectionSyncing: false,
        collectionSyncLeaseOwner: null,
        collectionSyncLeaseExpiresAt: null,
      },
    });

    return res.status(200).json({
      success: true,
      requestId,
      status: "CANCELLED_BEFORE_SHOPIFY",
      syncHistoryId: activeSync.id,
    });
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "collectionController.cancelCollectionsRefresh",
    });
    return res.status(500).json({
      error: "COLLECTION_CANCEL_FAILED",
      message: "Unable to cancel collection refresh",
      requestId,
    });
  }
};
