import { operationEventRepository } from "../../repositories/operationEventRepository.js";
import { targetSnapshotSetRepository } from "../../repositories/targetSnapshotSetRepository.js";
import { prisma } from "../../config/database.js";
import { assertShadowWriteAllowed } from "../shadowReadOnlyGuardService.js";

export const bulkEditExecutionService = {
  async execute({
    shop,
    operationId,
    workerId,
    expectedLockVersion = null,
    executionContext = null,
  }) {
    const operation = await prisma.merchantOperation.findFirst({
      where: { id: operationId, shop },
      select: {
        id: true,
        shop: true,
        processedItems: true,
        failedItems: true,
      },
    });

    if (!operation) {
      const error = new Error("OPERATION_NOT_FOUND");
      error.code = "OPERATION_NOT_FOUND";
      throw error;
    }

    const lease = await prisma.operationExecution.findFirst({
      where: {
        merchantOperationId: operationId,
        leaseOwner: workerId,
        leaseExpiresAt: { gt: new Date() },
        poisoned: false,
        ...(expectedLockVersion != null
          ? { lockVersion: BigInt(expectedLockVersion) }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, lockVersion: true },
    });

    if (!lease) {
      const error = new Error("LEASE_OWNER_REQUIRED");
      error.code = "LEASE_OWNER_REQUIRED";
      throw error;
    }

    const history = await prisma.editHistory.findFirst({
      where: { operationId, shop },
      select: {
        id: true,
        shop: true,
        targetMirrorBatchId: true,
      },
    });

    if (!history?.id) {
      const error = new Error("OPERATION_EDIT_HISTORY_NOT_LINKED");
      error.code = "OPERATION_EDIT_HISTORY_NOT_LINKED";
      throw error;
    }

    const totalTargets = await targetSnapshotSetRepository.countByOperation(
      operationId,
      shop,
    );

    assertShadowWriteAllowed(
      executionContext,
      "bulk_edit_execution_service.merchant_operation_update",
    );
    await prisma.merchantOperation.updateMany({
      where: { id: operationId, shop },
      data: {
        totalItems: Number(totalTargets || 0),
        processedItems: Number(operation.processedItems || 0),
        failedItems: Number(operation.failedItems || 0),
      },
    });

    assertShadowWriteAllowed(
      executionContext,
      "bulk_edit_execution_service.operation_event_emit",
    );
    await operationEventRepository.emit({
      shop,
      operationId,
      type: "EXECUTION_LEASE_VERIFIED",
      payload: {
        stage: "bulk.edit.execute.bootstrap",
        editHistoryId: history.id,
        totalTargets,
      },
    });

    return {
      operationId,
      editHistoryId: history.id,
      totalTargets,
      status: "DISPATCHING",
      readyForFinalize: false,
      lockVersion: lease.lockVersion,
    };
  },
};
