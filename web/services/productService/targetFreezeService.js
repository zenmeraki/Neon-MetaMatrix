import { operationEventRepository } from "../../repositories/operationEventRepository.js";
import { storeOperationRepository } from "../../repositories/storeOperationRepository.js";
import { targetSnapshotSetRepository } from "../../repositories/targetSnapshotSetRepository.js";

export const targetFreezeService = {
  async freezeForOperation({ shop, operationId, catalogBatchId, targetHash }) {
    const operation = await storeOperationRepository.findById(operationId);

    if (!operation || operation.shop !== shop) {
      throw new Error("OPERATION_NOT_FOUND");
    }

    if (!operation.editHistoryId) {
      throw new Error("OPERATION_EDIT_HISTORY_NOT_LINKED");
    }

    await targetSnapshotSetRepository.materializeFromEditHistory({
      operationId,
      shop,
      historyId: operation.editHistoryId,
    });

    await storeOperationRepository.updateById(operationId, {
      catalogBatchId: catalogBatchId || operation.catalogBatchId,
      targetHash: targetHash || operation.targetHash,
    });

    await operationEventRepository.emit({
      shop,
      operationId,
      type: "TARGET_FROZEN",
      payload: {
        catalogBatchId: catalogBatchId || operation.catalogBatchId,
        targetHash: targetHash || operation.targetHash,
      },
    });
  },
};
