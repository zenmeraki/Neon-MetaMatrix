import { prisma } from "../config/database.js";

function getClient(db) {
  return db || prisma;
}

export const storeOperationalStateRepository = {
  async getOrCreate(shop, db = prisma) {
    return getClient(db).storeOperationalState.upsert({
      where: { shop },
      update: {},
      create: {
        shop,
        catalogConsistencyStatus: "NOT_READY",
      },
    });
  },

  async setActiveWrite(shop, operationId, db = prisma) {
    return getClient(db).storeOperationalState.update({
      where: { shop },
      data: { activeWriteOperationId: operationId },
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
      update: { catalogConsistencyStatus: status, ...readyData },
      create: { shop, catalogConsistencyStatus: status, ...readyData },
    });
  },
};
