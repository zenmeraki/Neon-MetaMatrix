import { operationEventRepository } from "../../repositories/operationEventRepository.js";
import { targetSnapshotSetRepository } from "../../repositories/targetSnapshotSetRepository.js";
import { prisma } from "../../config/database.js";

export const targetFreezeService = {
  async freezeForOperation({ shop, operationId, targetHash }) {
    const operation = await prisma.merchantOperation.findFirst({
      where: { id: operationId, shop },
      select: {
        id: true,
        shop: true,
        status: true,
        targetHash: true,
        editHistory: {
          select: {
            id: true,
            targetMirrorBatchId: true,
          },
        },
      },
    });

    if (!operation) {
      throw new Error("OPERATION_NOT_FOUND");
    }

    if (!operation.editHistory?.id) {
      throw new Error("OPERATION_EDIT_HISTORY_NOT_LINKED");
    }

    if (!operation.editHistory.targetMirrorBatchId) {
      throw new Error("TARGET_MIRROR_BATCH_REQUIRED");
    }

    const resolvedTargetHash = targetHash || operation.targetHash || null;

    if (operation.status === "SNAPSHOTTED") {
      const targetCount = await targetSnapshotSetRepository.countByOperation(
        operationId,
        shop,
      );

      return {
        targetCount,
        targetHash: resolvedTargetHash,
      };
    }

    await targetSnapshotSetRepository.materializeFromEditHistory({
      operationId,
      shop,
      historyId: operation.editHistory.id,
    });
    const targetCount = await targetSnapshotSetRepository.countByOperation(
      operationId,
      shop,
    );

    await prisma.merchantOperation.updateMany({
      where: { id: operationId, shop },
      data: { targetHash: resolvedTargetHash },
    });

    await operationEventRepository.emit({
      shop,
      operationId,
      type: "TARGET_FROZEN",
      payload: {
        targetHash: resolvedTargetHash,
        targetCount,
      },
    });

    return {
      targetCount,
      targetHash: resolvedTargetHash,
    };
  },
};
