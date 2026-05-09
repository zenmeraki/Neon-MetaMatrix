import { operationEventRepository } from "../../repositories/operationEventRepository.js";
import { targetSnapshotSetRepository } from "../../repositories/targetSnapshotSetRepository.js";
import { prisma } from "../../config/database.js";

export const targetFreezeService = {
  async freezeForOperation({ shop, operationId, targetHash }) {
    const operation = await prisma.merchantOperation.findFirst({
      where: { id: operationId, shop },
      select: { id: true, shop: true, targetHash: true, editHistory: { select: { id: true } } },
    });

    if (!operation) {
      throw new Error("OPERATION_NOT_FOUND");
    }

    if (!operation.editHistory?.id) {
      throw new Error("OPERATION_EDIT_HISTORY_NOT_LINKED");
    }

    await targetSnapshotSetRepository.materializeFromEditHistory({
      operationId,
      shop,
      historyId: operation.editHistory.id,
    });

    await prisma.merchantOperation.updateMany({
      where: { id: operationId, shop },
      data: { targetHash: targetHash || operation.targetHash || null },
    });

    await operationEventRepository.emit({
      shop,
      operationId,
      type: "TARGET_FROZEN",
      payload: {
        targetHash: targetHash || operation.targetHash || null,
      },
    });
  },
};
