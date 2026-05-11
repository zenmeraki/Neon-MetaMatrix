import { prisma } from "../config/database.js";
import { assertOperationTransition } from "../constants/operationStateMachine.js";
import { merchantOperationRepository } from "../repositories/merchantOperationRepository.js";
import {
  projectOperationToBulkUndoExecution,
  projectOperationToEditHistory,
  projectOperationToExportJob,
  projectOperationToStoreOperation,
} from "./operationProjectionService.js";

function getClient(db) {
  return db || prisma;
}

async function applyProjections({ shop, operationId, projections = {}, db = prisma }) {
  const jobs = [];
  if (projections.editHistoryId) {
    jobs.push(
      projectOperationToEditHistory(
        { shop, operationId, editHistoryId: projections.editHistoryId },
        db,
      ),
    );
  }
  if (projections.exportJobId) {
    jobs.push(
      projectOperationToExportJob(
        { shop, operationId, exportJobId: projections.exportJobId },
        db,
      ),
    );
  }
  if (projections.undoExecutionIdentity) {
    jobs.push(
      projectOperationToBulkUndoExecution(
        {
          shop,
          operationId,
          executionIdentity: projections.undoExecutionIdentity,
        },
        db,
      ),
    );
  }
  if (projections.storeOperationId) {
    jobs.push(
      projectOperationToStoreOperation(
        { shop, operationId, storeOperationId: projections.storeOperationId },
        db,
      ),
    );
  }
  if (jobs.length) await Promise.all(jobs);
}

export const operationService = {
  async createOperation(input, db = prisma) {
    return merchantOperationRepository.createPlannedOperation(input, db);
  },

  async transitionOperation(
    { shop, operationId, from = null, to, data = {}, projections = null },
    db = prisma,
  ) {
    const client = getClient(db);
    if (!shop || !operationId || !to) {
      throw new Error("shop, operationId, and to are required");
    }

    let fromStatus = from;
    if (!fromStatus) {
      const current = await client.merchantOperation.findFirst({
        where: { id: operationId, shop },
        select: { status: true },
      });
      if (!current) throw new Error("OPERATION_NOT_FOUND");
      fromStatus = current.status;
    }

    assertOperationTransition(fromStatus, to);
    const result = await client.merchantOperation.updateMany({
      where: {
        id: operationId,
        shop,
        status: fromStatus,
      },
      data: {
        status: to,
        ...data,
      },
    });

    if (result.count !== 1) {
      throw new Error(`OPERATION_TRANSITION_CONFLICT:${operationId}:${fromStatus}->${to}`);
    }

    if (projections) {
      await applyProjections({ shop, operationId, projections, db });
    }

    return client.merchantOperation.findFirst({
      where: { id: operationId, shop },
    });
  },

  async transitionOperationIfCurrentIn(
    { shop, operationId, allowedCurrentStates = [], to, data = {}, projections = null },
    db = prisma,
  ) {
    const client = getClient(db);
    if (!shop || !operationId || !to || !allowedCurrentStates.length) {
      throw new Error("shop, operationId, allowedCurrentStates, and to are required");
    }

    for (const fromStatus of allowedCurrentStates) {
      assertOperationTransition(fromStatus, to);
    }

    const result = await client.merchantOperation.updateMany({
      where: {
        id: operationId,
        shop,
        status: { in: allowedCurrentStates },
      },
      data: {
        status: to,
        ...data,
      },
    });

    if (result.count !== 1) {
      throw new Error(
        `OPERATION_TRANSITION_CONFLICT:${operationId}:${allowedCurrentStates.join("|")}->${to}`,
      );
    }

    if (projections) {
      await applyProjections({ shop, operationId, projections, db });
    }

    return client.merchantOperation.findFirst({
      where: { id: operationId, shop },
    });
  },

  async recordExecution(
    { shop, operationId, executionKey, status = "PLANNED", attempt = 1, workerJobId = null, data = {} },
    db = prisma,
  ) {
    if (!shop || !operationId || !executionKey) {
      throw new Error("shop, operationId, and executionKey are required");
    }
    return getClient(db).operationExecution.upsert({
      where: {
        shop_executionKey: {
          shop,
          executionKey,
        },
      },
      update: {
        status,
        attempt,
        workerJobId,
        ...data,
      },
      create: {
        merchantOperationId: operationId,
        shop,
        executionKey,
        status,
        attempt,
        workerJobId,
        ...data,
      },
    });
  },

  async checkpointExecution(
    {
      shop,
      operationId,
      workerId = null,
      partitionOrdinal = null,
      targetOrdinal = null,
      heartbeatAt = new Date(),
      expectedLockVersion = null,
    },
    db = prisma,
  ) {
    if (!shop || !operationId) {
      throw new Error("shop and operationId are required");
    }

    const where = {
      merchantOperationId: operationId,
      shop,
      ...(workerId ? { leaseOwner: workerId } : {}),
      ...(expectedLockVersion != null
        ? { lockVersion: BigInt(expectedLockVersion) }
        : {}),
    };

    const execution = await getClient(db).operationExecution.findFirst({
      where,
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });

    if (!execution) return { updated: false };

    const result = await getClient(db).operationExecution.updateMany({
      where: {
        id: execution.id,
        ...(expectedLockVersion != null
          ? { lockVersion: BigInt(expectedLockVersion) }
          : {}),
      },
      data: {
        heartbeatAt,
        ...(Number.isInteger(partitionOrdinal) ? { lastCompletedPartition: partitionOrdinal } : {}),
        ...(Number.isInteger(targetOrdinal) ? { lastCompletedTargetOrdinal: targetOrdinal } : {}),
      },
    });

    return { updated: result.count === 1 };
  },

  async markExecutionPoisoned(
    { shop, operationId, workerId = null, retryExhaustedAt = new Date() },
    db = prisma,
  ) {
    if (!shop || !operationId) {
      throw new Error("shop and operationId are required");
    }

    const result = await getClient(db).operationExecution.updateMany({
      where: {
        merchantOperationId: operationId,
        shop,
        ...(workerId ? { leaseOwner: workerId } : {}),
      },
      data: {
        poisoned: true,
        retryExhaustedAt,
        heartbeatAt: new Date(),
      },
    });

    return { updated: Number(result?.count || 0) };
  },

  async recordVerificationResult(
    {
      shop,
      operationId,
      partitionId = null,
      expectedFingerprint,
      actualFingerprint,
      verified,
      mismatchReason = null,
    },
    db = prisma,
  ) {
    if (!shop || !operationId) {
      throw new Error("shop and operationId are required");
    }
    if (!expectedFingerprint || !actualFingerprint) {
      throw new Error("expectedFingerprint and actualFingerprint are required");
    }

    return getClient(db).verificationResult.create({
      data: {
        shop,
        operationId,
        partitionId,
        expectedFingerprint,
        actualFingerprint,
        verified: Boolean(verified),
        mismatchReason: mismatchReason || null,
      },
    });
  },

  async recordSubmission(
    {
      shop,
      operationId,
      type = "SHOPIFY_BULK_MUTATION",
      status = "PLANNED",
      dispatchJobId = null,
      dispatchAttempt = null,
      data = {},
    },
    db = prisma,
  ) {
    if (!shop || !operationId) {
      throw new Error("shop and operationId are required");
    }

    if (dispatchJobId && Number.isInteger(dispatchAttempt)) {
      return getClient(db).operationSubmission.upsert({
        where: {
          shop_merchantOperationId_dispatchJobId_dispatchAttempt: {
            shop,
            merchantOperationId: operationId,
            dispatchJobId,
            dispatchAttempt,
          },
        },
        update: {
          type,
          status,
          ...data,
        },
        create: {
          shop,
          merchantOperationId: operationId,
          type,
          status,
          dispatchJobId,
          dispatchAttempt,
          ...data,
        },
      });
    }

    return getClient(db).operationSubmission.create({
      data: {
        shop,
        merchantOperationId: operationId,
        type,
        status,
        dispatchJobId,
        dispatchAttempt,
        ...data,
      },
    });
  },

  async completeOperation(
    { shop, operationId, from = null, data = {}, projections = null },
    db = prisma,
  ) {
    return this.transitionOperation(
      {
        shop,
        operationId,
        from,
        to: "COMPLETED",
        data: {
          completedAt: data.completedAt || new Date(),
          ...data,
        },
        projections,
      },
      db,
    );
  },

  async failOperation(
    { shop, operationId, from = null, errorCode = null, errorMessage = null, data = {}, projections = null },
    db = prisma,
  ) {
    return this.transitionOperation(
      {
        shop,
        operationId,
        from,
        to: "FAILED",
        data: {
          failedAt: data.failedAt || new Date(),
          errorCode,
          errorMessage,
          ...data,
        },
        projections,
      },
      db,
    );
  },
};
