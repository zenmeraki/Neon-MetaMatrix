import { prisma } from "../config/database.js";

function getClient(db) {
  return db || prisma;
}

export const operationMutationRepository = {
  async hasApplied({ shop, entityId, field, operationId }, db = prisma) {
    const existing = await getClient(db).operationMutation.findUnique({
      where: {
        shop_entityId_field_operationId: {
          shop,
          entityId,
          field,
          operationId,
        },
      },
    });

    return Boolean(existing);
  },

  async markApplied({ shop, entityId, field, operationId, status = "APPLIED" }, db = prisma) {
    return getClient(db).operationMutation.upsert({
      where: {
        shop_entityId_field_operationId: {
          shop,
          entityId,
          field,
          operationId,
        },
      },
      update: { status },
      create: {
        shop,
        entityId,
        field,
        operationId,
        status,
      },
    });
  },
};
