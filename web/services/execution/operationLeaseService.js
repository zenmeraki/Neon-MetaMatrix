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
        merchantOperationId: operationId,
        workerJobId: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      select: { workerJobId: true },
    });
    if (existingLease?.workerJobId && existingLease.workerJobId !== workerId) {
      return { acquired: false, operationId, workerId, leaseExpiresAt: null };
    }

    const leaseExpiresAt = new Date(Date.now() + ttlMs);
    await prisma.operationExecution.upsert({
      where: {
        shop_executionKey: {
          shop: operation.shop,
          executionKey: `${operationId}:${workerId}`,
        },
      },
      update: {
        status: operation.status,
        workerJobId: workerId,
        startedAt: operation.startedAt || new Date(),
      },
      create: {
        merchantOperationId: operationId,
        shop: operation.shop,
        executionKey: `${operationId}:${workerId}`,
        status: operation.status,
        workerJobId: workerId,
        startedAt: operation.startedAt || new Date(),
      },
    });

    return {
      acquired: true,
      operationId,
      workerId,
      leaseExpiresAt,
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
        workerJobId: workerId,
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (!execution) {
      return { renewed: false, operationId, workerId, leaseExpiresAt: null };
    }

    const leaseExpiresAt = new Date(Date.now() + ttlMs);
    await prisma.operationExecution.update({
      where: { id: execution.id },
      data: { workerJobId: workerId, status: operation.status },
    });

    return {
      renewed: true,
      operationId,
      workerId,
      leaseExpiresAt,
    };
  },

  async release({ operationId, workerId }) {
    const execution = await prisma.operationExecution.findFirst({
      where: {
        merchantOperationId: operationId,
        workerJobId: workerId,
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (!execution) {
      return { released: false, operationId, workerId };
    }

    await prisma.operationExecution.update({
      where: { id: execution.id },
      data: { workerJobId: null },
    });

    return {
      released: true,
      operationId,
      workerId,
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
