import { prisma } from "../config/database.js";

function getClient(db) {
  return db || prisma;
}

export const STORE_WRITE_STATES = {
  IDLE: "IDLE",
  WRITE_RUNNING: "WRITE_RUNNING",
  AWAITING_SHOPIFY: "AWAITING_SHOPIFY",
  FINALIZING: "FINALIZING",
  RESYNC_REQUIRED: "RESYNC_REQUIRED",
  FAILED: "FAILED",
};

export const storeOperationalStateRepository = {
  async getOrCreate(shop, db = prisma) {
    return getClient(db).storeOperationalState.upsert({
      where: { shop },
      update: {},
      create: {
        shop,
        catalogConsistencyStatus: "NOT_READY",
        writeBlockedReason: STORE_WRITE_STATES.IDLE,
      },
    });
  },

  async setActiveWrite(shop, operationId, db = prisma) {
    return getClient(db).storeOperationalState.update({
      where: { shop },
      data: {
        activeWriteOperationId: operationId,
        writeBlockedReason: STORE_WRITE_STATES.WRITE_RUNNING,
      },
    });
  },

  async markAwaitingShopify(shop, operationId, db = prisma) {
    return getClient(db).storeOperationalState.updateMany({
      where: { shop, activeWriteOperationId: operationId },
      data: { writeBlockedReason: STORE_WRITE_STATES.AWAITING_SHOPIFY },
    });
  },

  async markFinalizing(shop, operationId, db = prisma) {
    return getClient(db).storeOperationalState.updateMany({
      where: { shop, activeWriteOperationId: operationId },
      data: { writeBlockedReason: STORE_WRITE_STATES.FINALIZING },
    });
  },

  async markResyncRequired(shop, operationId, db = prisma) {
    return getClient(db).storeOperationalState.updateMany({
      where: { shop, activeWriteOperationId: operationId },
      data: {
        activeWriteOperationId: null,
        lastWriteAt: new Date(),
        writeBlockedReason: STORE_WRITE_STATES.RESYNC_REQUIRED,
        catalogConsistencyStatus: "NOT_READY",
      },
    });
  },

  async markWriteFailed(shop, operationId, db = prisma) {
    return getClient(db).storeOperationalState.updateMany({
      where: { shop, activeWriteOperationId: operationId },
      data: {
        activeWriteOperationId: null,
        lastWriteAt: new Date(),
        writeBlockedReason: STORE_WRITE_STATES.FAILED,
      },
    });
  },

  async clearActiveWrite(shop, operationId, db = prisma) {
    return getClient(db).storeOperationalState.updateMany({
      where: {
        shop,
        activeWriteOperationId: operationId,
      },
      data: {
        activeWriteOperationId: null,
        lastWriteAt: new Date(),
        writeBlockedReason: STORE_WRITE_STATES.IDLE,
      },
    });
  },

  async setCatalogStatus(shop, status, details = {}, db = prisma) {
    const readyData =
      status === "READY"
        ? {
            activeCatalogBatchId: details.mirrorBatchId || undefined,
            activeProductBatchId: details.mirrorBatchId || undefined,
            activeVariantBatchId: details.mirrorBatchId || undefined,
            mirrorSchemaVersion: details.mirrorSchemaVersion || undefined,
            lastSyncAt: new Date(),
          }
        : {};

    return getClient(db).storeOperationalState.upsert({
      where: { shop },
      update: {
        catalogConsistencyStatus: status,
        ...readyData,
        ...(status === "READY"
          ? { writeBlockedReason: STORE_WRITE_STATES.IDLE }
          : {}),
      },
      create: {
        shop,
        catalogConsistencyStatus: status,
        ...readyData,
        writeBlockedReason:
          status === "READY"
            ? STORE_WRITE_STATES.IDLE
            : STORE_WRITE_STATES.RESYNC_REQUIRED,
      },
    });
  },
};
