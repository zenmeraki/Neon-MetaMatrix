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

export const storeOperationRepository = {
  async create(data, db = prisma) {
    const operation = await getClient(db).storeOperation.create({ data });
    recordOperationStarted({
      shop: operation.shop,
      operationType: operation.type,
    });
    return operation;
  },

  async findById(id, db = prisma) {
    return getClient(db).storeOperation.findUnique({ where: { id } });
  },

  async findByIdempotencyKey(idempotencyKey, db = prisma) {
    return getClient(db).storeOperation.findUnique({ where: { idempotencyKey } });
  },

  async updateById(id, data, db = prisma) {
    return getClient(db).storeOperation.update({
      where: { id },
      data,
    });
  },

  async acquireLease(id, leaseOwner, leaseExpiresAt, db = prisma) {
    const now = new Date();

    return getClient(db).storeOperation.updateMany({
      where: {
        id,
        status: { in: ["RUNNING", "QUEUED", "CLAIMED"] },
        OR: [
          { leaseOwner: null },
          { leaseOwner },
          { leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        leaseOwner,
        leaseExpiresAt,
        heartbeatAt: now,
      },
    });
  },

  async renewLease(id, leaseOwner, leaseExpiresAt, db = prisma) {
    return getClient(db).storeOperation.updateMany({
      where: {
        id,
        leaseOwner,
        status: "RUNNING",
      },
      data: {
        leaseExpiresAt,
        heartbeatAt: new Date(),
      },
    });
  },

  async releaseLease(id, leaseOwner, db = prisma) {
    return getClient(db).storeOperation.updateMany({
      where: {
        id,
        leaseOwner,
      },
      data: {
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  },

  async findActiveWriteByShop(shop, db = prisma) {
    return getClient(db).storeOperation.findFirst({
      where: {
        shop,
        status: { in: ["QUEUED", "CLAIMED", "RUNNING", "FINALIZING"] },
        type: { in: ["BULK_EDIT", "SCHEDULED_EDIT", "AUTOMATIC_RULE", "UNDO", "IMPORT"] },
      },
      orderBy: { createdAt: "asc" },
    });
  },

  async markRunning(id, db = prisma) {
    const now = new Date();

    return getClient(db).storeOperation.update({
      where: { id },
      data: {
        status: "RUNNING",
        startedAt: now,
        heartbeatAt: now,
      },
    });
  },

  async markRunningForLease(id, leaseOwner, db = prisma) {
    const now = new Date();

    return getClient(db).storeOperation.updateMany({
      where: { id, leaseOwner },
      data: {
        status: "RUNNING",
        startedAt: now,
        heartbeatAt: now,
      },
    });
  },

  async assertLeaseOwner(id, leaseOwner, db = prisma) {
    const operation = await getClient(db).storeOperation.findFirst({
      where: {
        id,
        leaseOwner,
        leaseExpiresAt: { gt: new Date() },
      },
    });

    if (!operation) {
      const error = new Error("LEASE_OWNER_REQUIRED");
      error.code = "LEASE_OWNER_REQUIRED";
      throw error;
    }

    return operation;
  },

  async heartbeat(id, db = prisma) {
    return getClient(db).storeOperation.update({
      where: { id },
      data: { heartbeatAt: new Date() },
    });
  },

  async complete(id, db = prisma) {
    const now = new Date();

    const operation = await getClient(db).storeOperation.update({
      where: { id },
      data: {
        status: "COMPLETED",
        completedAt: now,
        heartbeatAt: now,
      },
    });
    recordOperationDuration({
      shop: operation.shop,
      operationType: operation.type,
      status: "COMPLETED",
      startedAt: operation.startedAt,
    });
    return operation;
  },

  async completeForLease(id, leaseOwner, db = prisma) {
    const now = new Date();

    return getClient(db).storeOperation.updateMany({
      where: { id, leaseOwner },
      data: {
        status: "COMPLETED",
        completedAt: now,
        heartbeatAt: now,
      },
    });
  },

  async fail(id, { errorCode, errorMessage }, db = prisma) {
    const now = new Date();

    const operation = await getClient(db).storeOperation.update({
      where: { id },
      data: {
        status: "FAILED",
        failedAt: now,
        errorCode,
        errorMessage,
        heartbeatAt: now,
      },
    });
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
    const now = new Date();

    return getClient(db).storeOperation.updateMany({
      where: { id, leaseOwner },
      data: {
        status: "FAILED",
        failedAt: now,
        errorCode,
        errorMessage,
        heartbeatAt: now,
      },
    });
  },

  async updateProgressForLease(
    id,
    leaseOwner,
    { totalTargets, processedCount, successCount, failureCount },
    db = prisma,
  ) {
    const operation = await this.assertLeaseOwner(id, leaseOwner, db);
    assertOperationNotTimedOut(operation);

    return getClient(db).storeOperation.updateMany({
      where: { id, leaseOwner },
      data: {
        heartbeatAt: new Date(),
        ...(totalTargets !== undefined ? { totalTargets } : {}),
        ...(processedCount !== undefined ? { processedCount } : {}),
        ...(successCount !== undefined ? { successCount } : {}),
        ...(failureCount !== undefined ? { failureCount } : {}),
      },
    });
  },

  async failPartialForLease(
    id,
    leaseOwner,
    { errorCode, errorMessage, processedCount, successCount, failureCount },
    db = prisma,
  ) {
    const now = new Date();

    return getClient(db).storeOperation.updateMany({
      where: { id, leaseOwner },
      data: {
        status: "FAILED_PARTIAL",
        failedAt: now,
        errorCode,
        errorMessage,
        heartbeatAt: now,
        ...(processedCount !== undefined ? { processedCount } : {}),
        ...(successCount !== undefined ? { successCount } : {}),
        ...(failureCount !== undefined ? { failureCount } : {}),
      },
    });
  },
};
