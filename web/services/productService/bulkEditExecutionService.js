import { operationEventRepository } from "../../repositories/operationEventRepository.js";
import { targetSnapshotSetRepository } from "../../repositories/targetSnapshotSetRepository.js";
import { storeOperationRepository } from "../../repositories/storeOperationRepository.js";

export const bulkEditExecutionService = {
  async execute({ shop, operationId, workerId }) {
    const operation = await storeOperationRepository.assertLeaseOwner(
      operationId,
      workerId,
    );

    if (operation.shop !== shop) {
      throw new Error("OPERATION_NOT_FOUND");
    }

    if (!operation.editHistoryId) {
      throw new Error("OPERATION_EDIT_HISTORY_NOT_LINKED");
    }

    if (
      !operation.catalogBatchId ||
      !operation.productBatchId ||
      !operation.variantBatchId ||
      !operation.collectionBatchId
    ) {
      const error = new Error("OPERATION_SNAPSHOT_NOT_PINNED");
      error.code = "OPERATION_SNAPSHOT_NOT_PINNED";
      throw error;
    }

    const totalTargets = await targetSnapshotSetRepository.countByOperation(
      operationId,
    );

    await storeOperationRepository.updateProgressForLease(operationId, workerId, {
      totalTargets,
      processedCount: operation.processedCount || 0,
      successCount: operation.successCount || 0,
      failureCount: operation.failureCount || 0,
    });

    await operationEventRepository.emit({
      shop,
      operationId,
      type: "BATCH_PROCESSED",
      payload: {
        stage: "bulk.edit.execute",
        editHistoryId: operation.editHistoryId,
      },
    });

    return {
      operationId,
      editHistoryId: operation.editHistoryId,
    };
  },
};
