import { prisma } from "../Config/database.js";
import * as collectionMembershipRepository from "../repositories/collectionMembershipRepository.js";
import * as domainFreshnessService from "../services/sync/domainFreshnessService.js";
import * as syncRunService from "../services/sync/syncRunService.js";
import { clearKeyCaches } from "../utils/cacheUtils.js";
import {
  downloadJsonlStream,
  parseJsonlStream,
} from "../utils/jsonlStreamUtils.js";
import { logBatchEvent } from "../utils/batchObservability.js";

/**
 * Collection membership ingest worker.
 *
 * Current behavior:
 * - stages Collection mirror rows from Shopify bulk JSONL
 * - writes normalized ProductCollectionMembership rows
 * - updates Store.activeCollectionBatchId for compatibility
 */

const COLLECTION_CACHE_KEYS = (shop) => [
  `${shop}:sync_details`,
  `${shop}:fetchCollections`,
  `${shop}:ProductFilterValues:collection`,
];

const assertShop = (shop) => {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required");
  }
};

const assertBatchId = (catalogBatchId) => {
  if (!catalogBatchId || typeof catalogBatchId !== "string") {
    throw new Error("catalogBatchId is required");
  }
};

const assertUrl = (sourceUrl) => {
  if (!sourceUrl || typeof sourceUrl !== "string") {
    throw new Error("sourceUrl is required");
  }
};

const normalizeCollectionNode = (json) => {
  if (!json || !json.id) {
    return null;
  }

  if (json.__typename && json.__typename !== "Collection") {
    return null;
  }

  return {
    shopifyId: json.id,
    title: typeof json.title === "string" ? json.title.trim() : null,
    handle: json.handle || null,
  };
};

const toSafeDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeMembershipNode = ({ json, collection, shop, catalogBatchId }) => {
  if (!json?.__parentId || !collection?.shopifyId) {
    return null;
  }

  const sourceUpdatedAt = toSafeDate(json.updatedAt || collection.updatedAt);

  return {
    shop,
    catalogBatchId,
    productId: json.__parentId,
    collectionId: collection.shopifyId,
    collectionTitle: collection.title,
    collectionHandle: collection.handle,
    sourceUpdatedAt,
    sourceEventAt: sourceUpdatedAt,
  };
};

const uniqueBy = (rows, getKey) => {
  const seen = new Set();

  return rows.filter((row) => {
    const key = getKey(row);
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const stageCollectionRows = async ({
  shop,
  catalogBatchId,
  collectionRows,
  membershipRows,
}) => {
  const uniqueCollections = uniqueBy(collectionRows, (row) => {
    if (!row.shopifyId || !row.title) return false;
    return row.shopifyId;
  });

  const uniqueMemberships = uniqueBy(membershipRows, (row) => {
    if (!row.productId || !row.collectionId) return false;
    return `${row.productId}:${row.collectionId}`;
  });

  if (uniqueCollections.length > 0) {
    await collectionMembershipRepository.createManyCollectionMirrors(
      uniqueCollections.map((row) => ({
        shop,
        shopifyId: row.shopifyId,
        catalogBatchId,
        mirrorBatchId: catalogBatchId,
        title: row.title,
        handle: row.handle,
      })),
    );
  }

  if (uniqueMemberships.length > 0) {
    await collectionMembershipRepository.createManyCollectionMemberships(
      uniqueMemberships,
    );
  }

  return {
    collectionCount: uniqueCollections.length,
    membershipCount: uniqueMemberships.length,
  };
};

const parseAndStageCollections = async ({ dataStream, shop, catalogBatchId }) => {
  const batchSize = 500;
  let collectionBatch = [];
  let membershipBatch = [];
  let collectionCount = 0;
  let membershipCount = 0;
  const seenCollectionIds = new Set();
  const seenMembershipKeys = new Set();

  const flush = async () => {
    const currentCollections = collectionBatch;
    const currentMemberships = membershipBatch;
    collectionBatch = [];
    membershipBatch = [];

    const result = await stageCollectionRows({
      shop,
      catalogBatchId,
      collectionRows: currentCollections,
      membershipRows: currentMemberships,
    });

    collectionCount += result.collectionCount;
    membershipCount += result.membershipCount;
  };

  for await (const { value: json } of parseJsonlStream(dataStream)) {
    const collection = normalizeCollectionNode(json);

    if (!collection) continue;

    if (!seenCollectionIds.has(collection.shopifyId)) {
      seenCollectionIds.add(collection.shopifyId);
      collectionBatch.push(collection);
    }

    const membership = normalizeMembershipNode({
      json,
      collection,
      shop,
      catalogBatchId,
    });

    if (membership) {
      const membershipKey = `${membership.productId}:${membership.collectionId}`;

      if (!seenMembershipKeys.has(membershipKey)) {
        seenMembershipKeys.add(membershipKey);
        membershipBatch.push(membership);
      }
    }

    if (
      collectionBatch.length >= batchSize ||
      membershipBatch.length >= batchSize
    ) {
      await flush();
    }
  }

  await flush();

  return {
    collectionCount,
    membershipCount,
    recordCount: membershipCount || collectionCount,
  };
};

export const ingestCollectionMembershipArtifact = async ({
  shop,
  sourceUrl,
  catalogBatchId,
  syncRunId = null,
  syncHistoryId = null,
}) => {
  assertShop(shop);
  assertUrl(sourceUrl);
  assertBatchId(catalogBatchId);

  try {
    const previousStore = await prisma.store.findUnique({
      where: { shopUrl: shop },
      select: { activeCollectionBatchId: true },
    });
    logBatchEvent("catalog_batch_ingest_write", {
      shop,
      syncRunId,
      oldMirrorBatchId: previousStore?.activeCollectionBatchId || null,
      newCatalogBatchId: catalogBatchId,
      resolvedCatalogBatchId: catalogBatchId,
      path: "ingest",
      extra: {
        syncHistoryId,
        source: "collection_membership_artifact",
      },
    });

    const productCount = await prisma.product.count({
      where: {
        shop,
        catalogBatchId,
      },
    });

    if (productCount <= 0) {
      const error = new Error(
        "Cannot ingest collection memberships for a catalog batch with no products",
      );
      error.code = "COLLECTION_BATCH_WITHOUT_PRODUCTS";
      error.httpStatus = 409;
      error.details = {
        shop,
        catalogBatchId,
      };
      throw error;
    }

    if (syncRunId) {
      await syncRunService.heartbeatSyncRun({
        syncRunId,
        stage: "COLLECTION_MEMBERSHIP_STAGING",
        responseUrl: sourceUrl,
      });
    }

    await Promise.all([
      collectionMembershipRepository.deleteCollectionMembershipsByBatch({
        shop,
        catalogBatchId,
      }),
      collectionMembershipRepository.deleteCollectionMirrorsByBatch({
        shop,
        catalogBatchId,
      }),
    ]);

    const dataStream = await downloadJsonlStream({
      sourceUrl,
      errorLabel: "collection artifact",
    });
    const { recordCount, collectionCount, membershipCount } =
      await parseAndStageCollections({
        dataStream,
        shop,
        catalogBatchId,
      });

    logBatchEvent("catalog_batch_ingest_write", {
      shop,
      syncRunId,
      oldMirrorBatchId: previousStore?.activeCollectionBatchId || null,
      newCatalogBatchId: catalogBatchId,
      resolvedCatalogBatchId: catalogBatchId,
      path: "ingest",
      extra: {
        syncHistoryId,
        source: "collection_membership_artifact",
        recordCount,
        collectionCount,
        membershipCount,
      },
    });

    await domainFreshnessService.markDomainFresh({
      shop,
      domain: domainFreshnessService.FRESHNESS_DOMAIN.COLLECTION,
      lastFreshAt: new Date(),
      source: "COLLECTION_MEMBERSHIP_INGEST",
      sourceRunId: syncRunId,
      catalogBatchId,
      details: {
        recordCount,
        collectionCount,
        membershipCount,
      },
    }).catch(() => {});

    await prisma.store.update({
      where: { shopUrl: shop },
      data: {
        isCollectionSyncing: false,
        lastCollectionSyncAt: new Date(),
        activeCollectionBatchId: catalogBatchId,
        lastCollectionReconcileAt: new Date(),
        lastReconcileAt: new Date(),
        mirrorHealthState: "HEALTHY",
        staleReason: null,
        repairRequired: false,
      },
    });

    if (
      previousStore?.activeCollectionBatchId &&
      previousStore.activeCollectionBatchId !== catalogBatchId
    ) {
      await Promise.all([
        collectionMembershipRepository.deleteCollectionMembershipsByBatch({
          shop,
          catalogBatchId: previousStore.activeCollectionBatchId,
        }).catch(() => {}),
        collectionMembershipRepository.deleteCollectionMirrorsByBatch({
          shop,
          catalogBatchId: previousStore.activeCollectionBatchId,
        }),
      ]);
    }

    if (syncHistoryId) {
      await prisma.syncHistory.update({
        where: { id: syncHistoryId },
        data: {
          status: "completed",
          stage: "COMPLETED",
          responseUrl: sourceUrl,
          recordCount,
        },
      }).catch(() => {});
    }

    if (syncRunId) {
      await syncRunService.markSyncRunCompleted({
        syncRunId,
        stage: "COLLECTION_MEMBERSHIP_COMPLETED",
        rowCount: recordCount,
        catalogBatchId,
        responseUrl: sourceUrl,
      }).catch(() => {});
    }

    await Promise.all(
      COLLECTION_CACHE_KEYS(shop).map((cacheKey) => clearKeyCaches(cacheKey)),
    );

    return {
      success: true,
      shop,
      catalogBatchId,
      recordCount,
      collectionCount,
      membershipCount,
    };
  } catch (error) {
    if (syncRunId) {
      await syncRunService.markSyncRunFailed({
        syncRunId,
        stage: "COLLECTION_MEMBERSHIP_FAILED",
        failureCode: error.code || "COLLECTION_MEMBERSHIP_INGEST_FAILED",
        failureMessage: error.message || "Collection membership ingest failed",
        responseUrl: sourceUrl,
      }).catch(() => {});
    }

    await domainFreshnessService.markDomainStale({
      shop,
      domain: domainFreshnessService.FRESHNESS_DOMAIN.COLLECTION,
      staleReason: error.message || "Collection membership ingest failed",
      repairRequired: false,
      source: "COLLECTION_MEMBERSHIP_INGEST",
      sourceRunId: syncRunId,
      catalogBatchId,
    }).catch(() => {});

    throw error;
  }
};

export const processCollectionMembershipIngestJob =
  ingestCollectionMembershipArtifact;
