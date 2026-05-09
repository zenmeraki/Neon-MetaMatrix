import { prisma } from "../config/database.js";

function getClient(db) {
  return db || prisma;
}

export const syncHistoryRepository = {
  async findByBulkOperation({ shop, bulkOperationId }, db = prisma) {
    if (!bulkOperationId) return null;

    return getClient(db).syncHistory.findFirst({
      where: {
        shop,
        bulkOperationId,
      },
      orderBy: { createdAt: "asc" },
    });
  },
};
