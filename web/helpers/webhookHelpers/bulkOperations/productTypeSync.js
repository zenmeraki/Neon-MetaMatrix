import shopify from "../../../shopify.js";
import axios from "axios";
import readline from "readline";
import { getSession } from "../../../utils/sessionHandler.js";
import { productFilterService } from "../../../services/productService/productFilterService.js";
import CacheService from "../../../utils/cacheService.js";
import { emitToUser } from "../../../socket.js";
import { clearKeyCaches } from "../../../utils/cacheUtils.js";
import { enqueueAutomaticProductRuleSignalJob } from "../../../services/automaticProductRuleExecutionService.js";
import { prisma } from "../../../config/database.js";
import {
  createMirrorBatchId,
  markFullSyncFailed,
} from "../../../services/mirrorHealthService.js";
import { recordMirrorAnomaly } from "../../../services/mirrorAnomalyService.js";
import { assertShopMatch } from "../../../utils/assertShopMatch.js";

async function reconcileProductCollectionJson({ shop, collectionBatchId }) {
  if (!shop || !collectionBatchId) return;

  const store = await prisma.store.findUnique({
    where: { shopUrl: shop },
    select: { activeMirrorBatchId: true },
  });
  const productBatchId = store?.activeMirrorBatchId;
  if (!productBatchId) return;

  const [memberships, collections] = await Promise.all([
    prisma.productCollectionMembership.findMany({
      where: { shop, mirrorBatchId: collectionBatchId },
      select: { productId: true, collectionId: true },
    }),
    prisma.collection.findMany({
      where: { shop, mirrorBatchId: collectionBatchId },
      select: { shopifyId: true, title: true, handle: true, collectionType: true },
    }),
  ]);

  const collectionById = new Map(
    collections
      .filter((collection) => collection.shopifyId)
      .map((collection) => [collection.shopifyId, collection]),
  );
  const collectionsByProduct = new Map();

  for (const membership of memberships) {
    const collection = collectionById.get(membership.collectionId);
    if (!collection?.title) continue;

    const productCollections =
      collectionsByProduct.get(membership.productId) || [];
    productCollections.push({
      id: membership.collectionId,
      title: collection.title,
      handle: collection.handle || null,
      type: collection.collectionType || null,
    });
    collectionsByProduct.set(membership.productId, productCollections);
  }

  await prisma.product.updateMany({
    where: { shop, mirrorBatchId: productBatchId },
    data: { collectionsJson: [] },
  });

  const entries = Array.from(collectionsByProduct.entries());
  for (let index = 0; index < entries.length; index += 100) {
    const chunk = entries.slice(index, index + 100);
    await prisma.$transaction(
      chunk.map(([productId, collectionsJson]) =>
        prisma.product.updateMany({
          where: { shop, mirrorBatchId: productBatchId, id: productId },
          data: { collectionsJson },
        }),
      ),
    );
  }
}

async function validateCollectionMirrorBatch({ shop, collectionBatchId }) {
  const [collectionCount, membershipCount, orphanMemberships] = await Promise.all([
    prisma.collection.count({
      where: { shop, mirrorBatchId: collectionBatchId },
    }),
    prisma.productCollectionMembership.count({
      where: { shop, mirrorBatchId: collectionBatchId },
    }),
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM "ProductCollectionMembership" pcm
      LEFT JOIN "Collection" c
        ON c."shop" = pcm."shop"
       AND c."shopifyId" = pcm."collectionId"
       AND c."mirrorBatchId" = pcm."mirrorBatchId"
      WHERE pcm."shop" = ${shop}
        AND pcm."mirrorBatchId" = ${collectionBatchId}
        AND c."id" IS NULL
    `,
  ]);

  const orphanMembershipCount = Number(orphanMemberships?.[0]?.count || 0);
  const errors = [];
  if (collectionCount <= 0) errors.push("Collection batch is empty");
  if (orphanMembershipCount > 0) {
    errors.push("Collection memberships reference missing collections");
  }

  return {
    ready: errors.length === 0,
    collectionCount,
    membershipCount,
    orphanMembershipCount,
    errors,
  };
}

async function activateCollectionMirrorBatch({
  shop,
  collectionBatchId,
  bulkOperation,
  syncHistory,
  recordCount,
}) {
  const validation = await validateCollectionMirrorBatch({
    shop,
    collectionBatchId,
  });

  if (!validation.ready) {
    const error = new Error(
      `Collection mirror validation failed: ${validation.errors.join(", ")}`,
    );
    error.code = "COLLECTION_MIRROR_VALIDATION_FAILED";
    throw error;
  }

  const createdAt = bulkOperation.createdAt
    ? new Date(bulkOperation.createdAt)
    : new Date();
  const completedAt = bulkOperation.completedAt
    ? new Date(bulkOperation.completedAt)
    : new Date();
  const durationMs = Math.max(completedAt.getTime() - createdAt.getTime(), 0);
  let previousCollectionBatchId = null;

  await prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({
      where: { shopUrl: shop },
      select: { activeCollectionBatchId: true },
    });
    previousCollectionBatchId = store?.activeCollectionBatchId || null;

    await tx.collectionMirrorBatch.update({
      where: { id: collectionBatchId },
      data: {
        status: "ACTIVATED",
        collectionCount: validation.collectionCount,
        membershipCount: validation.membershipCount,
        activatedAt: completedAt,
      },
    });

    await tx.store.update({
      where: { shopUrl: shop },
      data: {
        isCollectionSyncing: false,
        collectionSyncLeaseOwner: null,
        collectionSyncLeaseExpiresAt: null,
        lastCollectionSyncAt: completedAt,
        activeCollectionBatchId: collectionBatchId,
        lastCollectionReconcileAt: completedAt,
        lastReconcileAt: completedAt,
        mirrorHealthState: "HEALTHY",
        staleReason: null,
        repairRequired: false,
      },
    });

    await tx.storeOperationalState.upsert({
      where: { shop },
      update: {
        activeCollectionBatchId: collectionBatchId,
        lastSyncAt: completedAt,
      },
      create: {
        shop,
        activeCollectionBatchId: collectionBatchId,
        catalogConsistencyStatus: "NOT_READY",
        lastSyncAt: completedAt,
      },
    });

    await tx.syncHistory.update({
      where: { id: syncHistory.id },
      data: {
        status: "completed",
        stage: "COLLECTION_MIRROR_ACTIVATED",
        responseUrl: bulkOperation.url,
        duration: durationMs,
        recordCount,
      },
    });
  });

  if (previousCollectionBatchId && previousCollectionBatchId !== collectionBatchId) {
    await prisma.productCollectionMembership.deleteMany({
      where: {
        shop,
        mirrorBatchId: previousCollectionBatchId,
      },
    });
    await prisma.collection.deleteMany({
      where: {
        shop,
        mirrorBatchId: previousCollectionBatchId,
      },
    });
    await prisma.collectionMirrorBatch.updateMany({
      where: {
        id: previousCollectionBatchId,
        shop,
        status: { not: "RETIRED" },
      },
      data: { status: "RETIRED" },
    });
  }

  return {
    activated: true,
    collectionBatchId,
    previousCollectionBatchId,
    collectionCount: validation.collectionCount,
    membershipCount: validation.membershipCount,
  };
}

export async function handleSyncOperation({
  bulkOperationId,
  shop = null,
  webhookJobId = null,
  attempt = null,
}) {
  let syncHistory = null;

  try {
    syncHistory = await prisma.syncHistory.findFirst({
      where: {
        bulkOperationId,
        ...(shop ? { shop } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    if (!syncHistory) {
      return {
        skipped: true,
        reason: "sync_history_not_found",
        bulkOperationId,
      };
    }

    if (shop) {
      assertShopMatch({
        jobShop: shop,
        dbShop: syncHistory.shop,
        context: "bulk_operation_query_sync_history",
        jobId: webhookJobId,
        entityType: "syncHistory",
        entityId: syncHistory.id,
      });
    }

    // Idempotency: do not re-process a sync that already finalized
    if (
      syncHistory.operationType === "Product" &&
      (syncHistory.status === "completed" ||
        syncHistory.stage === "MIRROR_ACTIVATED" ||
        syncHistory.stage === "COMPLETED")
    ) {
      return {
        skipped: true,
        reason: "already_completed",
        bulkOperationId,
        syncHistoryId: syncHistory.id,
        syncRunId: syncHistory.id,
        operationId: null,
      };
    }

    // Atomic claim: only one worker may transition Shopify-completed -> mirror-processing
    if (syncHistory.operationType === "Product") {
      const claimed = await prisma.syncHistory.updateMany({
        where: {
          id: syncHistory.id,
          status: "processing",
          stage: {
            in: ["SHOPIFY_BULK_RUNNING"],
          },
        },
        data: {
          stage: "MIRROR_DOWNLOAD_STARTED",
        },
      });

      if (claimed.count !== 1) {
        return {
          skipped: true,
          reason: "already_claimed_or_not_processable",
          bulkOperationId,
          syncHistoryId: syncHistory.id,
        };
      }

      syncHistory = await prisma.syncHistory.findUnique({
        where: { id: syncHistory.id },
      });
    }

    if (syncHistory.operationType === "Product" && !syncHistory.syncBatchId) {
      const syncBatchId = createMirrorBatchId("product_sync");

      syncHistory = await prisma.syncHistory.update({
        where: { id: syncHistory.id },
        data: { syncBatchId },
      });
    }

    let recordCount = 0;
    const session = await getSession(syncHistory.shop);

    if (!session) {
      throw new Error(`No session found for shop ${syncHistory.shop}`);
    }
    assertShopMatch({
      jobShop: syncHistory.shop,
      dbShop: session.shop,
      context: "bulk_operation_query_session",
      jobId: webhookJobId,
      entityType: "syncHistory",
      entityId: syncHistory.id,
    });

    const bulkOperation = await fetchBulkOperationDetails(session, bulkOperationId);

    if (!bulkOperation) {
      throw new Error("Failed to retrieve bulk operation details");
    }

    if (bulkOperation.id !== bulkOperationId) {
      throw new Error("BULK_OPERATION_ID_MISMATCH");
    }

    if (bulkOperation.errorCode) {
      throw new Error(
        `Bulk operation failed in Shopify. status=${bulkOperation.status} errorCode=${bulkOperation.errorCode}`,
      );
    }

    if (bulkOperation.status !== "COMPLETED") {
      throw new Error(
        `Bulk operation is not completed yet. status=${bulkOperation.status}`,
      );
    }

    if (!bulkOperation.url || typeof bulkOperation.url !== "string") {
      throw new Error(
        `Bulk operation completed but result URL is missing. status=${bulkOperation.status}`,
      );
    }

    if (syncHistory.operationType === "Collection") {
      const claimed = await prisma.syncHistory.updateMany({
        where: {
          id: syncHistory.id,
          status: "processing",
          stage: "SHOPIFY_BULK_RUNNING",
        },
        data: {
          stage: "COLLECTION_MIRROR_STAGING",
        },
      });

      if (claimed.count !== 1) {
        return {
          skipped: true,
          reason: "already_claimed_or_not_processable",
          bulkOperationId,
          syncHistoryId: syncHistory.id,
        };
      }
    }

    const urlResponse = await axios.get(new URL(bulkOperation.url).toString(), {
      headers: { Accept: "application/json" },
      responseType: "stream",
    });

    if (urlResponse.status !== 200) {
      throw new Error(`Failed to download bulk result. status=${urlResponse.status}`);
    }

    if (syncHistory.operationType === "Collection") {
      await processSyncDataInBatches(
        urlResponse.data,
        session.shop,
        "Collection",
        syncHistory.syncBatchId,
      );

      recordCount = await prisma.collection.count({
        where: {
          shop: session.shop,
          ...(syncHistory.syncBatchId
            ? { mirrorBatchId: syncHistory.syncBatchId }
            : {}),
        },
      });

      await activateCollectionMirrorBatch({
        shop: session.shop,
        collectionBatchId: syncHistory.syncBatchId,
        bulkOperation,
        syncHistory,
        recordCount,
      });

      await reconcileProductCollectionJson({
        shop: session.shop,
        collectionBatchId: syncHistory.syncBatchId,
      });

      await clearKeyCaches(`${session.shop}:sync_details`);
      await clearKeyCaches(`${session.shop}:fetchCollections`);
      await clearKeyCaches(`${session.shop}:ProductFilterValues:collection`);
    }

    if (syncHistory.operationType === "Product") {
      const syncResult = await productFilterService.formatAndSyncProductsToDB({
        dataStream: urlResponse.data,
        shop: session.shop,
        session,
        syncBatchId: syncHistory.syncBatchId,
        syncHistoryId: syncHistory.id,
      });

      recordCount = syncResult.totalProductsProcessed || 0;

      await clearKeyCaches(`${session.shop}:ProductFetch:`);
      await clearKeyCaches(`${session.shop}:productTypes:`);
      await clearKeyCaches(`${session.shop}:ProductFilterValues:`);

      emitToUser(session.shop, "product_sync", {
        message: "Product sync completed",
        totalProductsProcessed: syncResult.totalProductsProcessed || 0,
        totalVariantsProcessed: syncResult.totalVariantsProcessed || 0,
      });

      await enqueueAutomaticProductRuleSignalJob({
        shop: session.shop,
        triggerReference: `reindex:${bulkOperationId}`,
        triggerSource: "REINDEX",
      });
    }

    await clearKeyCaches(`${session.shop}:storeDetails`);
    await clearKeyCaches(`${session.shop}:ProductFetch`);
    await clearKeyCaches(`${session.shop}:sync_details`);

    return {
      message: "syncing completed",
      recordCount,
      syncRunId: syncHistory.id,
      operationId: null,
    };
  } catch (err) {
    if (syncHistory) {
      if (syncHistory.operationType === "Collection" && syncHistory.syncBatchId) {
        await prisma.collectionMirrorBatch
          .updateMany({
            where: {
              id: syncHistory.syncBatchId,
              shop: syncHistory.shop,
              status: { notIn: ["ACTIVATED", "RETIRED"] },
            },
            data: {
              status: "FAILED",
            },
          })
          .catch(() => {});
      }

      await prisma.syncHistory
        .update({
          where: { id: syncHistory.id },
          data: {
            status: "failed",
            stage: "FAILED",
            errorMessage: err.message,
          },
        })
        .catch(() => {});
    }

    if (syncHistory?.shop) {
      await prisma.store
        .update({
          where: { shopUrl: syncHistory.shop },
          data: {
            isProductSyncing: false,
            isCollectionSyncing: false,
            isProductTypeSyncing: false,
            isProductInitialySyning: false,
            syncProgressStage: "IDLE",
          },
        })
        .catch(() => {});

      await markFullSyncFailed({
        shop: syncHistory.shop,
        errorSummary: err.message,
      }).catch(() => {});

      await recordMirrorAnomaly({
        shop: syncHistory.shop,
        severity: "critical",
        type: "bulk_sync_finalize_failure",
        entityType: "syncHistory",
        entityId: syncHistory.id,
        message: err.message,
        details: {
          bulkOperationId,
          operationType: syncHistory.operationType,
          webhookJobId,
          attempt,
        },
      }).catch(() => {});
    }

    throw err;
  }
}

async function fetchBulkOperationDetails(session, bulkOperationId) {
  const query = `query GetBulkOperationResults($id: ID!) {
    node(id: $id) {
      ... on BulkOperation {
        id
        status
        errorCode
        url
        partialDataUrl
        objectCount
        rootObjectCount
        completedAt
        createdAt
        fileSize
        type
      }
    }
  }`;

  const client = new shopify.api.clients.Graphql({ session });
  const response = await client.query({
    data: {
      query,
      variables: { id: bulkOperationId },
    },
  });

  return response.body?.data?.node;
}

export async function processSyncDataInBatches(
  dataStream,
  shop,
  type,
  syncBatchId = null,
) {
  const batchSize = 100;
  let collectionBatch = [];
  let membershipBatch = [];

  if (type === "Collection" && syncBatchId) {
    await prisma.productCollectionMembership.deleteMany({
      where: { shop, mirrorBatchId: syncBatchId },
    });
    await prisma.collection.deleteMany({
      where: { shop, mirrorBatchId: syncBatchId },
    });
  }

  const insertBatch = async () => {
    if (!collectionBatch.length && !membershipBatch.length) return;

    if (type === "Collection") {
      const seenCollections = new Set();
      const uniqueCollections = collectionBatch.filter((collection) => {
        if (!collection.title || !collection.shopifyId) return false;
        const key = collection.shopifyId;
        if (seenCollections.has(key)) return false;
        seenCollections.add(key);
        return true;
      });
      const seenMemberships = new Set();
      const uniqueMemberships = membershipBatch.filter((membership) => {
        if (!membership.productId || !membership.collectionId) return false;
        const key = `${membership.productId}:${membership.collectionId}`;
        if (seenMemberships.has(key)) return false;
        seenMemberships.add(key);
        return true;
      });

      await prisma.$transaction(async (tx) => {
        if (uniqueCollections.length > 0) {
          await tx.collection.createMany({
            data: uniqueCollections.map((collection) => ({
              shop,
              shopifyId: collection.shopifyId,
              mirrorBatchId: syncBatchId,
              title: collection.title,
              handle: collection.handle || null,
              collectionType: collection.collectionType || null,
            })),
            skipDuplicates: true,
          });
        }

        if (uniqueMemberships.length > 0) {
          await tx.productCollectionMembership.createMany({
            data: uniqueMemberships.map((membership) => ({
              shop,
              productId: membership.productId,
              collectionId: membership.collectionId,
              mirrorBatchId: syncBatchId,
            })),
            skipDuplicates: true,
          });
        }
      });
    }

    collectionBatch = [];
    membershipBatch = [];
  };

  const rl = readline.createInterface({
    input: dataStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const json = JSON.parse(line);

      if (type === "Collection") {
        if (!json.__parentId && json.__typename === "Collection") {
          const collectionType = json?.ruleSet ? "SMART" : "MANUAL";
          collectionBatch.push({
            shopifyId: json.id,
            title: json.title?.trim(),
            handle: json.handle?.trim(),
            collectionType,
          });
        }

        if (json.__parentId && json.__typename === "Product") {
          membershipBatch.push({
            collectionId: json.__parentId,
            productId: json.id,
          });
        }
      }

      if (collectionBatch.length + membershipBatch.length >= batchSize) {
        await insertBatch();
      }
    } catch (error) {
      await recordMirrorAnomaly({
        shop,
        severity: "medium",
        type: "sync_stream_parse_error",
        entityType: "store",
        entityId: shop,
        message: error.message,
        details: { type },
      }).catch(() => {});
    }
  }

  await insertBatch();
}
