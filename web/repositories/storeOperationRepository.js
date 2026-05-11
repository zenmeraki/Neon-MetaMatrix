import { prisma } from "../config/database.js";
import {
  recordOperationDuration,
  recordOperationFailed,
  recordOperationStarted,
} from "../utils/metricsUtils.js";
import { assertOperationNotTimedOut } from "../services/execution/operationTimeoutGuard.js";

function getClient(db) {
  return db || prisma;
}

const LEGACY_WRITE_TYPES = new Set([
  "BULK_EDIT",
  "SCHEDULED_EDIT",
  "RECURRING_EDIT",
  "AUTOMATIC_RULE",
  "UNDO",
  "BULK_UNDO",
  "IMPORT",
]);

const LEGACY_TO_MERCHANT_TYPE = {
  BULK_EDIT: "BULK_EDIT",
  SCHEDULED_EDIT: "SCHEDULED_EDIT",
  RECURRING_EDIT: "RECURRING_EDIT",
  AUTOMATIC_RULE: "SCHEDULED_EDIT",
  UNDO: "BULK_UNDO",
  BULK_UNDO: "BULK_UNDO",
  IMPORT: "IMPORT",
  EXPORT: "EXPORT",
  SCHEDULED_EXPORT: "SCHEDULED_EXPORT",
};

const LEGACY_TO_MERCHANT_STATUS = {
  QUEUED: "SNAPSHOTTED",
  CLAIMED: "SNAPSHOTTED",
  RUNNING: "DISPATCHING",
  FINALIZING: "APPLYING_RESULTS",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  FAILED_PARTIAL: "FAILED",
  EXPIRED: "FAILED",
  CANCELLED: "CANCELLED",
};

const MERCHANT_TO_LEGACY_STATUS = {
  PLANNED: "QUEUED",
  SNAPSHOTTING: "RUNNING",
  SNAPSHOTTED: "QUEUED",
  DISPATCHING: "RUNNING",
  AWAITING_SHOPIFY: "RUNNING",
  APPLYING_RESULTS: "FINALIZING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
};

const ACTIVE_MERCHANT_STATUSES = [
  "PLANNED",
  "SNAPSHOTTING",
  "SNAPSHOTTED",
  "DISPATCHING",
  "AWAITING_SHOPIFY",
  "APPLYING_RESULTS",
];

function toMerchantType(type) {
  return LEGACY_TO_MERCHANT_TYPE[String(type || "").toUpperCase()] || "BULK_EDIT";
}

function toMerchantStatus(status) {
  return LEGACY_TO_MERCHANT_STATUS[String(status || "").toUpperCase()] || "PLANNED";
}

function toLegacyStatus(status) {
  return MERCHANT_TO_LEGACY_STATUS[String(status || "")] || "QUEUED";
}

function toLegacyOperation(operation, execution = null) {
  if (!operation) return null;
  return {
    id: operation.id,
    shop: operation.shop,
    type: operation.type,
    status: toLegacyStatus(operation.status),
    requestedBy: null,
    source: operation.source,
    lockKey: null,
    leaseOwner: execution?.workerJobId || null,
    leaseExpiresAt: null,
    idempotencyKey: operation.idempotencyKey,
    editHistoryId: operation.editHistory?.id || null,
    targetHash: operation.targetHash,
    catalogBatchId: null,
    productBatchId: null,
    variantBatchId: null,
    collectionBatchId: null,
    mirrorBatchId: operation.immutableSnapshots?.[0]?.mirrorBatchId || null,
    totalTargets: operation.totalItems,
    processedCount: operation.processedItems,
    successCount: Math.max(
      Number(operation.processedItems || 0) - Number(operation.failedItems || 0),
      0,
    ),
    failureCount: operation.failedItems,
    startedAt: operation.startedAt,
    completedAt: operation.completedAt,
    failedAt: operation.failedAt,
    heartbeatAt: execution?.updatedAt || operation.updatedAt,
    errorCode: operation.errorCode,
    errorMessage: operation.errorMessage,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
  };
}

async function findLeaseExecution(client, operationId, workerId = null) {
  return client.operationExecution.findFirst({
    where: {
      merchantOperationId: operationId,
      ...(workerId ? { workerJobId: workerId } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
}

async function upsertLeaseExecution(client, operation, workerId, status) {
  const executionKey = `${operation.id}:${workerId}`;
  return client.operationExecution.upsert({
    where: {
      shop_executionKey: {
        shop: operation.shop,
        executionKey,
      },
    },
    update: {
      status,
      workerJobId: workerId,
      startedAt: operation.startedAt || new Date(),
    },
    create: {
      merchantOperationId: operation.id,
      shop: operation.shop,
      executionKey,
      status,
      workerJobId: workerId,
      startedAt: new Date(),
    },
  });
}

export const storeOperationRepository = {
  async create(data, db = prisma) {
    const client = getClient(db);
    const operation = await client.merchantOperation.upsert({
      where: {
        shop_idempotencyKey: {
          shop: data.shop,
          idempotencyKey: data.idempotencyKey,
        },
      },
      update: {
        status: toMerchantStatus(data.status),
        totalItems: Number(data.totalTargets ?? data.totalItems ?? 0),
        processedItems: Number(data.processedCount || 0),
        failedItems: Number(data.failureCount || 0),
        targetHash: data.targetHash || null,
      },
      create: {
        ...(data.id ? { id: data.id } : {}),
        shop: data.shop,
        type: toMerchantType(data.type),
        status: toMerchantStatus(data.status),
        title: data.type || "Operation",
        source: data.source || "operation",
        idempotencyKey: data.idempotencyKey,
        targetHash: data.targetHash || null,
        totalItems: Number(data.totalTargets ?? data.totalItems ?? 0),
        processedItems: Number(data.processedCount || 0),
        failedItems: Number(data.failureCount || 0),
        startedAt: data.startedAt || null,
        completedAt: data.completedAt || null,
        failedAt: data.failedAt || null,
        errorCode: data.errorCode || null,
        errorMessage: data.errorMessage || null,
      },
      include: { editHistory: true, immutableSnapshots: true },
    });

    if (data.editHistoryId) {
      await client.editHistory.updateMany({
        where: { id: data.editHistoryId, shop: data.shop },
        data: { operationId: operation.id },
      });
    }

    recordOperationStarted({
      shop: operation.shop,
      operationType: operation.type,
    });
    return toLegacyOperation(operation);
  },

  async findById(id, db = prisma) {
    const client = getClient(db);
    const operation = await client.merchantOperation.findUnique({
      where: { id },
      include: { editHistory: true, immutableSnapshots: true },
    });
    if (!operation) return null;
    const execution = await findLeaseExecution(client, id);
    return toLegacyOperation(operation, execution);
  },

  async findByIdempotencyKey(idempotencyKey, db = prisma) {
    const client = getClient(db);
    const operation = await client.merchantOperation.findFirst({
      where: { idempotencyKey },
      include: { editHistory: true, immutableSnapshots: true },
    });
    if (!operation) return null;
    const execution = await findLeaseExecution(client, operation.id);
    return toLegacyOperation(operation, execution);
  },

  async updateById(id, data, db = prisma) {
    const client = getClient(db);
    const operation = await client.merchantOperation.update({
      where: { id },
      data: {
        ...(data.status !== undefined ? { status: toMerchantStatus(data.status) } : {}),
        ...(data.totalTargets !== undefined ? { totalItems: Number(data.totalTargets) } : {}),
        ...(data.processedCount !== undefined ? { processedItems: Number(data.processedCount) } : {}),
        ...(data.failureCount !== undefined ? { failedItems: Number(data.failureCount) } : {}),
        ...(data.targetHash !== undefined ? { targetHash: data.targetHash } : {}),
        ...(data.startedAt !== undefined ? { startedAt: data.startedAt } : {}),
        ...(data.completedAt !== undefined ? { completedAt: data.completedAt } : {}),
        ...(data.failedAt !== undefined ? { failedAt: data.failedAt } : {}),
        ...(data.errorCode !== undefined ? { errorCode: data.errorCode } : {}),
        ...(data.errorMessage !== undefined ? { errorMessage: data.errorMessage } : {}),
      },
      include: { editHistory: true, immutableSnapshots: true },
    });
    return toLegacyOperation(operation);
  },

  async acquireLease(id, leaseOwner, leaseExpiresAt, db = prisma) {
    const client = getClient(db);
    const operation = await client.merchantOperation.findFirst({
      where: { id, status: { in: ACTIVE_MERCHANT_STATUSES } },
    });
    if (!operation) return { count: 0 };

    const existingLease = await findLeaseExecution(client, id);
    if (existingLease?.workerJobId && existingLease.workerJobId !== leaseOwner) {
      return { count: 0 };
    }

    await upsertLeaseExecution(client, operation, leaseOwner, operation.status);
    return { count: 1, leaseExpiresAt };
  },

  async renewLease(id, leaseOwner, leaseExpiresAt, db = prisma) {
    const client = getClient(db);
    const execution = await findLeaseExecution(client, id, leaseOwner);
    if (!execution) return { count: 0 };
    await client.operationExecution.update({
      where: { id: execution.id },
      data: { workerJobId: leaseOwner },
    });
    return { count: 1, leaseExpiresAt };
  },

  async releaseLease(id, leaseOwner, db = prisma) {
    const client = getClient(db);
    const execution = await findLeaseExecution(client, id, leaseOwner);
    if (!execution) return { count: 0 };
    await client.operationExecution.update({
      where: { id: execution.id },
      data: { workerJobId: null },
    });
    return { count: 1 };
  },

  async findActiveWriteByShop(shop, db = prisma) {
    const client = getClient(db);
    const operation = await client.merchantOperation.findFirst({
      where: {
        shop,
        status: { in: ACTIVE_MERCHANT_STATUSES },
        type: { in: [...LEGACY_WRITE_TYPES].map(toMerchantType) },
      },
      orderBy: { createdAt: "asc" },
      include: { editHistory: true, immutableSnapshots: true },
    });
    return toLegacyOperation(operation);
  },

  async markRunning(id, db = prisma) {
    return this.updateById(id, { status: "RUNNING", startedAt: new Date() }, db);
  },

  async markRunningForLease(id, leaseOwner, db = prisma) {
    const client = getClient(db);
    const execution = await findLeaseExecution(client, id, leaseOwner);
    if (!execution) return { count: 0 };
    await client.merchantOperation.updateMany({
      where: { id },
      data: { status: "DISPATCHING", startedAt: new Date() },
    });
    await client.operationExecution.update({
      where: { id: execution.id },
      data: { status: "DISPATCHING", startedAt: execution.startedAt || new Date() },
    });
    return { count: 1 };
  },

  async assertLeaseOwner(id, leaseOwner, db = prisma) {
    const operation = await this.findById(id, db);
    const execution = await findLeaseExecution(getClient(db), id, leaseOwner);
    if (!operation || !execution) {
      const error = new Error("LEASE_OWNER_REQUIRED");
      error.code = "LEASE_OWNER_REQUIRED";
      throw error;
    }
    return operation;
  },

  async assertLeaseOwnerForShop(id, shop, leaseOwner, db = prisma) {
    const operation = await this.assertLeaseOwner(id, leaseOwner, db);
    if (operation.shop !== shop) {
      const error = new Error("LEASE_OWNER_REQUIRED");
      error.code = "LEASE_OWNER_REQUIRED";
      throw error;
    }
    return operation;
  },

  async findLinkedEditHistoryForLease({ operationId, shop, workerId }, db = prisma) {
    await this.assertLeaseOwnerForShop(operationId, shop, workerId, db);
    return getClient(db).editHistory.findFirst({
      where: { operationId, shop },
      select: {
        id: true,
        shop: true,
        targetMirrorBatchId: true,
      },
    });
  },

  async heartbeat(id, db = prisma) {
    const operation = await this.findById(id, db);
    if (!operation) return null;
    const execution = await findLeaseExecution(getClient(db), id);
    if (execution) {
      await getClient(db).operationExecution.update({
        where: { id: execution.id },
        data: { status: execution.status },
      });
    }
    return operation;
  },

  async complete(id, db = prisma) {
    const now = new Date();
    const operation = await this.updateById(id, { status: "COMPLETED", completedAt: now }, db);
    recordOperationDuration({
      shop: operation.shop,
      operationType: operation.type,
      status: "COMPLETED",
      startedAt: operation.startedAt,
    });
    return operation;
  },

  async completeForLease(id, leaseOwner, db = prisma) {
    const operation = await this.assertLeaseOwner(id, leaseOwner, db);
    await getClient(db).merchantOperation.updateMany({
      where: { id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    return { count: operation ? 1 : 0 };
  },

  async fail(id, { errorCode, errorMessage }, db = prisma) {
    const now = new Date();
    const operation = await this.updateById(
      id,
      { status: "FAILED", failedAt: now, errorCode, errorMessage },
      db,
    );
    recordOperationFailed({
      shop: operation.shop,
      operationType: operation.type,
      reason: errorCode || "FAILED",
    });
    recordOperationDuration({
      shop: operation.shop,
      operationType: operation.type,
      status: "FAILED",
      startedAt: operation.startedAt,
    });
    return operation;
  },

  async failForLease(id, leaseOwner, { errorCode, errorMessage }, db = prisma) {
    const operation = await this.assertLeaseOwner(id, leaseOwner, db);
    await getClient(db).merchantOperation.updateMany({
      where: { id },
      data: {
        status: "FAILED",
        failedAt: new Date(),
        errorCode,
        errorMessage,
      },
    });
    return { count: operation ? 1 : 0 };
  },

  async updateProgressForLease(
    id,
    leaseOwner,
    { totalTargets, processedCount, failureCount },
    db = prisma,
  ) {
    const operation = await this.assertLeaseOwner(id, leaseOwner, db);
    assertOperationNotTimedOut(operation);

    await getClient(db).merchantOperation.updateMany({
      where: { id },
      data: {
        ...(totalTargets !== undefined ? { totalItems: Number(totalTargets) } : {}),
        ...(processedCount !== undefined ? { processedItems: Number(processedCount) } : {}),
        ...(failureCount !== undefined ? { failedItems: Number(failureCount) } : {}),
      },
    });
    return { count: 1 };
  },

  async failPartialForLease(
    id,
    leaseOwner,
    { errorCode, errorMessage, processedCount, failureCount },
    db = prisma,
  ) {
    const operation = await this.assertLeaseOwner(id, leaseOwner, db);
    await getClient(db).merchantOperation.updateMany({
      where: { id },
      data: {
        status: "FAILED",
        failedAt: new Date(),
        errorCode,
        errorMessage,
        ...(processedCount !== undefined ? { processedItems: Number(processedCount) } : {}),
        ...(failureCount !== undefined ? { failedItems: Number(failureCount) } : {}),
      },
    });
    return { count: operation ? 1 : 0 };
  },
};
