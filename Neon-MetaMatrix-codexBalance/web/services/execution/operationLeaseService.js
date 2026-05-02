import os from "os";
import { prisma } from "../../config/database.js";

const DEFAULT_LEASE_MS = Number(process.env.OPERATION_LEASE_MS || 5 * 60 * 1000);

function defaultWorkerId(prefix = "worker") {
  return `${prefix}:${os.hostname()}:${process.pid}`;
}

function leaseUntil(ms = DEFAULT_LEASE_MS) {
  return new Date(Date.now() + ms);
}

export const operationLeaseService = {
  workerId(prefix = "worker") {
    return defaultWorkerId(prefix);
  },

  async acquireEditHistoryLease({
    shop,
    historyId,
    executionIdentity,
    workerId = defaultWorkerId("edit"),
    leaseMs = DEFAULT_LEASE_MS,
    allowedStates = ["queued", "dispatching", "failed"],
  }) {
    const updated = await prisma.editHistory.updateMany({
      where: {
        id: historyId,
        shop,
        executionIdentity,
        executionState: { in: allowedStates },
        OR: [
          { executionLeaseUntil: null },
          { executionLeaseUntil: { lt: new Date() } },
          { executionLeaseOwner: workerId },
        ],
      },
      data: {
        executionLeaseOwner: workerId,
        executionLeaseUntil: leaseUntil(leaseMs),
        lastExecutionAttemptAt: new Date(),
        executionAttemptCount: { increment: 1 },
      },
    });

    if (updated.count !== 1) {
      return { acquired: false, workerId };
    }

    return { acquired: true, workerId };
  },

  async heartbeatEditHistoryLease({
    shop,
    historyId,
    executionIdentity,
    workerId,
    leaseMs = DEFAULT_LEASE_MS,
  }) {
    const updated = await prisma.editHistory.updateMany({
      where: {
        id: historyId,
        shop,
        executionIdentity,
        executionLeaseOwner: workerId,
        executionLeaseUntil: { gt: new Date() },
      },
      data: {
        executionLeaseUntil: leaseUntil(leaseMs),
      },
    });

    return { renewed: updated.count === 1 };
  },

  async releaseEditHistoryLease({
    shop,
    historyId,
    executionIdentity,
    workerId,
  }) {
    await prisma.editHistory.updateMany({
      where: {
        id: historyId,
        shop,
        executionIdentity,
        executionLeaseOwner: workerId,
      },
      data: {
        executionLeaseOwner: null,
        executionLeaseUntil: null,
      },
    });
  },

  async acquireUndoLease({
    shop,
    executionIdentity,
    workerId = defaultWorkerId("undo"),
    leaseMs = DEFAULT_LEASE_MS,
    allowedStates = [
      "planned",
      "queued",
      "frozen",
      "dispatching",
      "awaiting_shopify",
      "FREEZING",
      "FROZEN",
      "DISPATCHING",
      "AWAITING_SHOPIFY",
    ],
  }) {
    const updated = await prisma.bulkUndoExecution.updateMany({
      where: {
        shop,
        executionIdentity,
        state: { in: allowedStates },
        OR: [
          { leaseUntil: null },
          { leaseUntil: { lt: new Date() } },
          { leaseOwner: workerId },
        ],
      },
      data: {
        leaseOwner: workerId,
        leaseUntil: leaseUntil(leaseMs),
        heartbeatAt: new Date(),
        attemptCount: { increment: 1 },
      },
    });

    return { acquired: updated.count === 1, workerId };
  },

  async heartbeatUndoLease({
    shop,
    executionIdentity,
    workerId,
    leaseMs = DEFAULT_LEASE_MS,
  }) {
    const updated = await prisma.bulkUndoExecution.updateMany({
      where: {
        shop,
        executionIdentity,
        leaseOwner: workerId,
        leaseUntil: { gt: new Date() },
      },
      data: {
        leaseUntil: leaseUntil(leaseMs),
        heartbeatAt: new Date(),
      },
    });

    return { renewed: updated.count === 1 };
  },

  async releaseUndoLease({ shop, executionIdentity, workerId }) {
    await prisma.bulkUndoExecution.updateMany({
      where: {
        shop,
        executionIdentity,
        leaseOwner: workerId,
      },
      data: {
        leaseOwner: null,
        leaseUntil: null,
      },
    });
  },
};
