import { prisma } from "../../config/database.js";

export async function createUndoRequest({ shop, executionId, requestedBy }) {
  const changeCount = await prisma.changeRecord.count({
    where: { shop, executionId },
  });

  if (changeCount === 0) {
    throw new Error("UNDO_NOT_AVAILABLE_NO_CHANGE_RECORDS");
  }

  return prisma.undoRequest.upsert({
    where: {
      shop_executionId: {
        shop,
        executionId,
      },
    },
    update: {},
    create: {
      shop,
      executionId,
      requestedBy: requestedBy ?? null,
      status: "REQUESTED",
    },
  });
}
