import { prisma } from "../config/database.js";

function getClient(db) {
  return db || prisma;
}

export const operationMutationRepository = {
  async hasApplied({ shop, entityId, field, operationId }, db = prisma) {
    const existing = await getClient(db).operationMutation.findUnique({
      where: {
        shop_operationId_entityId_field: {
          shop,
          operationId,
          entityId,
          field,
        },
      },
    });

    return Boolean(existing);
  },

  async markApplied({ shop, entityId, field, operationId, status = "APPLIED", entityType = "UNKNOWN", batchId = null }, db = prisma) {
    return getClient(db).operationMutation.upsert({
      where: {
        shop_operationId_entityId_field: {
          shop,
          operationId,
          entityId,
          field,
        },
      },
      update: { status, entityType, batchId },
      create: {
        shop,
        operationId,
        entityId,
        entityType,
        field,
        batchId,
        status,
      },
    });
  },
};
