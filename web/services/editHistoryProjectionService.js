import { prisma } from "../config/database.js";
import { projectOperationToEditHistory } from "./operationProjectionService.js";

function getClient(db) {
  return db || prisma;
}

export const editHistoryProjectionService = {
  async syncFromOperation({ shop, operationId, editHistoryId = null }, db = prisma) {
    if (!shop || !operationId) {
      throw new Error("shop and operationId are required");
    }

    let targetEditHistoryId = editHistoryId;
    if (!targetEditHistoryId) {
      const history = await getClient(db).editHistory.findFirst({
        where: { shop, operationId },
        select: { id: true },
      });
      targetEditHistoryId = history?.id || null;
    }

    if (!targetEditHistoryId) {
      return { count: 0 };
    }

    return projectOperationToEditHistory(
      { shop, operationId, editHistoryId: targetEditHistoryId },
      db,
    );
  },
};

