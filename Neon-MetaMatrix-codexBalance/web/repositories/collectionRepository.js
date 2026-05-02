import { prisma } from "../config/database.js";

const DEFAULT_COLLECTION_LIMIT = 20;
const MAX_COLLECTION_LIMIT = 100;

function getClient(db) {
  return db || prisma;
}

function assertShop(shop) {
  if (typeof shop !== "string" || !shop.trim()) {
    throw new Error("shop is required");
  }

  return shop.trim();
}

function normalizeLimit(limit) {
  const parsed = Number.parseInt(limit, 10);

  if (!Number.isFinite(parsed)) return DEFAULT_COLLECTION_LIMIT;

  return Math.min(MAX_COLLECTION_LIMIT, Math.max(1, parsed));
}

function normalizeSearch(search) {
  return typeof search === "string" ? search.trim() : "";
}

export const collectionRepository = {
  async getActiveReadSnapshotForShop(shop, db = prisma) {
    const safeShop = assertShop(shop);
    const store = await getClient(db).store.findUnique({
      where: { shopUrl: safeShop },
      select: {
        activeCollectionBatchId: true,
        activeMirrorBatchId: true,
      },
    });

    if (!store?.activeCollectionBatchId) {
      throw new Error("Active collection snapshot is required");
    }

    if (!store?.activeMirrorBatchId) {
      throw new Error("Active product mirror snapshot is required");
    }

    return {
      collectionBatchId: store.activeCollectionBatchId,
      productMirrorBatchId: store.activeMirrorBatchId,
    };
  },

  async listByShopAndSnapshot(
    {
      shop,
      collectionBatchId,
      search = "",
      cursorId = null,
      limit = DEFAULT_COLLECTION_LIMIT,
    },
    db = prisma,
  ) {
    const safeShop = assertShop(shop);
    const safeSearch = normalizeSearch(search);
    const safeLimit = normalizeLimit(limit);

    if (!collectionBatchId) {
      throw new Error("collectionBatchId is required");
    }

    return getClient(db).collection.findMany({
      where: {
        shop: safeShop,
        mirrorBatchId: collectionBatchId,
        deletedAt: null,
        ...(cursorId ? { id: { gt: cursorId } } : {}),
        ...(safeSearch
          ? {
              title: {
                contains: safeSearch,
                mode: "insensitive",
              },
            }
          : {}),
      },
      select: {
        id: true,
        shopifyId: true,
        title: true,
        handle: true,
        mirrorBatchId: true,
      },
      orderBy: [{ title: "asc" }, { id: "asc" }],
      take: safeLimit,
    });
  },

  async reserveCollectionSync({ shop, syncBatchId, now, staleBefore }, db = prisma) {
    const safeShop = assertShop(shop);

    if (!syncBatchId) {
      throw new Error("syncBatchId is required");
    }

    const client = getClient(db);

    return client.$transaction(async (tx) => {
      const reservation = await tx.store.updateMany({
        where: {
          shopUrl: safeShop,
          OR: [
            { isCollectionSyncing: false },
            { lastCollectionSyncAt: null },
            { lastCollectionSyncAt: { lt: staleBefore } },
          ],
        },
        data: {
          isCollectionSyncing: true,
          lastCollectionSyncAt: now,
        },
      });

      if (reservation.count !== 1) {
        throw new Error("Collection sync already in progress");
      }

      const syncHistory = await tx.syncHistory.create({
        data: {
          shop: safeShop,
          status: "processing",
          syncBatchId,
          stage: "SHOPIFY_BULK_STARTING",
          operationType: "Collection",
          duration: 0,
          recordCount: 0,
        },
        select: {
          id: true,
          syncBatchId: true,
          stage: true,
        },
      });

      return syncHistory;
    });
  },

  async markCollectionSyncRunning(
    { shop, syncHistoryId, bulkOperationId },
    db = prisma,
  ) {
    const safeShop = assertShop(shop);

    if (!syncHistoryId) {
      throw new Error("syncHistoryId is required");
    }

    if (!bulkOperationId) {
      throw new Error("bulkOperationId is required");
    }

    return getClient(db).syncHistory.updateMany({
      where: {
        id: syncHistoryId,
        shop: safeShop,
        status: "processing",
        operationType: "Collection",
      },
      data: {
        bulkOperationId,
        stage: "SHOPIFY_BULK_RUNNING",
      },
    });
  },

  async markCollectionSyncStartFailed(
    { shop, syncHistoryId, errorMessage },
    db = prisma,
  ) {
    const safeShop = assertShop(shop);
    const client = getClient(db);

    return client.$transaction([
      client.syncHistory.updateMany({
        where: {
          id: syncHistoryId,
          shop: safeShop,
          operationType: "Collection",
          status: "processing",
        },
        data: {
          status: "failed",
          stage: "SHOPIFY_BULK_START_FAILED",
          errorMessage: errorMessage || "Collection sync failed to start",
        },
      }),
      client.store.updateMany({
        where: {
          shopUrl: safeShop,
          isCollectionSyncing: true,
        },
        data: {
          isCollectionSyncing: false,
        },
      }),
    ]);
  },
};
