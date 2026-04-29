import { prisma } from "../config/database.js";

function getClient(db) {
  return db || prisma;
}

export const operationEventRepository = {
  async emit({ shop, operationId, type, payload = null }, db = prisma) {
    return getClient(db).operationEvent.create({
      data: {
        shop,
        operationId,
        type,
        payload,
      },
    });
  },

  async listByOperation(operationId, db = prisma) {
    return getClient(db).operationEvent.findMany({
      where: { operationId },
      orderBy: { createdAt: "asc" },
    });
  },
};
