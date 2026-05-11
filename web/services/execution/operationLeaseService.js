import { prisma } from "../../config/database.js";
import { assertOperationNotTimedOut } from "./operationTimeoutGuard.js";
import logger from "../../utils/loggerUtils.js";

const ACTIVE_STATUSES = [
  "PLANNED",
  "SNAPSHOTTING",
  "SNAPSHOTTED",
  "DISPATCHING",
  "AWAITING_SHOPIFY",
  "APPLYING_RESULTS",
  "VERIFYING",
];

export const operationLeaseService = {
  async acquire({ operationId, workerId, ttlMs = 30_000 }) {
    const operation = await prisma.merchantOperation.findUnique({
      where: { id: operationId },
      select: { id: true, shop: true, status: true, startedAt: true },
    });
    if (!operation || !ACTIVE_STATUSES.includes(operation.status)) {
      return { acquired: false, operationId, workerId, leaseExpiresAt: null };
    }

    const existingLease = await prisma.operationExecution.findFirst({
      where: {
        merchantOperationId: operation.id,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        shop: true,
        executionKey: true,
        workerJobId: true,
        leaseOwner: true,
        leaseExpiresAt: true,
        lockVersion: true,
        poisoned: true,
      },
    });
    if (existingLease?.poisoned) {
      return { acquired: false, operationId, workerId, leaseExpiresAt: null };
    }

    const now = new Date();
    const leaseHeldByOther =
      existingLease &&
      existingLease.leaseOwner &&
      existingLease.leaseOwner !== workerId &&
      existingLease.leaseExpiresAt &&
      existingLease.leaseExpiresAt > now;

    if (leaseHeldByOther) {
      return { acquired: false, operationId, workerId, leaseExpiresAt: null };
    }

    const leaseExpiresAt = new Date(now.getTime() + ttlMs);
    const executionKey = `${operationId}:${workerId}`;

    const execution = await prisma.operationExecution.upsert({
      where: {
        shop_executionKey: {
          shop: operation.shop,
          executionKey,
        },
      },
      update: {
        status: operation.status,
        workerJobId: workerId,
        leaseOwner: workerId,
        leaseExpiresAt,
        heartbeatAt: now,
        lockVersion: { increment: 1 },
        poisoned: false,
        startedAt: operation.startedAt || new Date(),
      },
      create: {
        merchantOperationId: operationId,
        shop: operation.shop,
        executionKey,
        status: operation.status,
        workerJobId: workerId,
        leaseOwner: workerId,
        leaseExpiresAt,
        heartbeatAt: now,
        lockVersion: BigInt(1),
        poisoned: false,
        startedAt: operation.startedAt || new Date(),
      },
      select: {
        lockVersion: true,
      },
    });

    return {
      acquired: true,
      operationId,
      workerId,
      leaseExpiresAt,
      lockVersion: execution.lockVersion,
    };
  },

  async renew({ operationId, workerId, ttlMs = 30_000 }) {
    const operation = await prisma.merchantOperation.findUnique({
      where: { id: operationId },
      select: { id: true, shop: true, status: true, startedAt: true, updatedAt: true },
    });
    if (!operation) {
      return { renewed: false, operationId, workerId, leaseExpiresAt: null };
    }
    assertOperationNotTimedOut(operation);

    const execution = await prisma.operationExecution.findFirst({
      where: {
        merchantOperationId: operationId,
        leaseOwner: workerId,
        poisoned: false,
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, leaseExpiresAt: true },
    });
    if (!execution) {
      return { renewed: false, operationId, workerId, leaseExpiresAt: null };
    }

    const now = new Date();
    if (execution.leaseExpiresAt && execution.leaseExpiresAt <= now) {
      return { renewed: false, operationId, workerId, leaseExpiresAt: null };
    }

    const leaseExpiresAt = new Date(now.getTime() + ttlMs);
    const renewed = await prisma.operationExecution.updateMany({
      where: {
        id: execution.id,
        leaseOwner: workerId,
        leaseExpiresAt: { gt: now },
      },
      data: {
        workerJobId: workerId,
        leaseOwner: workerId,
        leaseExpiresAt,
        heartbeatAt: now,
        status: operation.status,
        lockVersion: { increment: 1 },
      },
    });

    if (renewed.count !== 1) {
      return { renewed: false, operationId, workerId, leaseExpiresAt: null };
    }

    const latest = await prisma.operationExecution.findUnique({
      where: { id: execution.id },
      select: { lockVersion: true },
    });

    return {
      renewed: true,
      operationId,
      workerId,
      leaseExpiresAt,
      lockVersion: latest?.lockVersion || null,
    };
  },

  async release({ operationId, workerId, expectedLockVersion = null }) {
    const execution = await prisma.operationExecution.findFirst({
      where: {
        merchantOperationId: operationId,
        leaseOwner: workerId,
        ...(expectedLockVersion != null
          ? { lockVersion: BigInt(expectedLockVersion) }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (!execution) {
      return { released: false, operationId, workerId };
    }

    await prisma.operationExecution.update({
      where: { id: execution.id },
      data: {
        workerJobId: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });

    return {
      released: true,
      operationId,
      workerId,
    };
  },

  async assertActive({ operationId, workerId, expectedLockVersion = null }) {
    const execution = await prisma.operationExecution.findFirst({
      where: {
        merchantOperationId: operationId,
        leaseOwner: workerId,
        poisoned: false,
        ...(expectedLockVersion != null
          ? { lockVersion: BigInt(expectedLockVersion) }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        leaseExpiresAt: true,
        lockVersion: true,
      },
    });

    const now = new Date();
    if (!execution?.leaseExpiresAt || execution.leaseExpiresAt <= now) {
      const error = new Error(
        expectedLockVersion != null
          ? "OPERATION_LEASE_FENCE_MISMATCH"
          : "OPERATION_LEASE_NOT_ACTIVE",
      );
      error.code =
        expectedLockVersion != null
          ? "OPERATION_LEASE_FENCE_MISMATCH"
          : "OPERATION_LEASE_NOT_ACTIVE";
      throw error;
    }

    return {
      active: true,
      operationId,
      workerId,
      leaseExpiresAt: execution.leaseExpiresAt,
      lockVersion: execution.lockVersion,
    };
  },

  async withLease({ operationId, workerId, ttlMs = 30_000 }, fn) {
    const lease = await this.acquire({ operationId, workerId, ttlMs });

    if (!lease.acquired) {
      const error = new Error("LEASE_NOT_ACQUIRED");
      error.code = "LEASE_NOT_ACQUIRED";
      throw error;
    }

    const renewLease = setInterval(() => {
      this.renew({ operationId, workerId, ttlMs }).catch((error) => {
        logger.error("Lease renewal failed", {
          operationId,
          message: error.message,
        });
      });
    }, Math.max(1_000, Math.floor(ttlMs / 3)));

    try {
      return await fn(lease);
    } finally {
      clearInterval(renewLease);
      await this.release({ operationId, workerId });
    }
  },
};
