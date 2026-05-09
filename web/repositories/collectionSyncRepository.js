import { prisma } from "../config/database.js";

const COLLECTION_LEASE_TTL_MS = 15 * 60 * 1000;

function leaseExpiry(now = new Date()) {
  return new Date(now.getTime() + COLLECTION_LEASE_TTL_MS);
}

export const collectionSyncRepository = {
  async acquireLease({ shop, leaseOwner, now = new Date() }, db = prisma) {
    return db.store.updateMany({
      where: {
        shopUrl: shop,
        OR: [
          { isCollectionSyncing: false },
          {
            isCollectionSyncing: true,
            collectionSyncLeaseExpiresAt: { lt: now },
          },
        ],
      },
      data: {
        isCollectionSyncing: true,
        collectionSyncStartedAt: now,
        collectionSyncLeaseOwner: leaseOwner,
        collectionSyncLeaseExpiresAt: leaseExpiry(now),
        lastCollectionSyncAt: now,
      },
    });
  },

  async releaseLease({ shop, leaseOwner }, db = prisma) {
    return db.store.updateMany({
      where: {
        shopUrl: shop,
        collectionSyncLeaseOwner: leaseOwner,
      },
      data: {
        isCollectionSyncing: false,
        collectionSyncLeaseOwner: null,
        collectionSyncLeaseExpiresAt: null,
      },
    });
  },
};
