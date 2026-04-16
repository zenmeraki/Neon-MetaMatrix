import { addbulkEditJob } from "../Jobs/Queues/bulkEditJob.js";
import { prisma } from "../Config/database.js";
import logger from "../utils/loggerUtils.js";

const PENDING_STATUSES = ["PENDING", "FAILED_RETRYABLE"];

export async function createBulkEditJobOutbox(tx, {
  historyId,
  shop,
  source,
  executionId,
}) {
  const payload = {
    historyId,
    shop,
    source,
    executionId,
  };

  return tx.bulkEditJobOutbox.create({
    data: {
      shop,
      editHistoryId: historyId,
      executionIdentity: executionId,
      source,
      payload,
      status: "PENDING",
    },
  });
}

export async function drainBulkEditJobOutbox({ limit = 25 } = {}) {
  const pending = await prisma.bulkEditJobOutbox.findMany({
    where: {
      status: { in: PENDING_STATUSES },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let dispatched = 0;

  for (const item of pending) {
    const claimed = await prisma.bulkEditJobOutbox.updateMany({
      where: {
        id: item.id,
        status: { in: PENDING_STATUSES },
      },
      data: {
        status: "DISPATCHING",
        claimedAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    if (!claimed.count) {
      continue;
    }

    try {
      await addbulkEditJob(item.payload, {
        jobId: item.editHistoryId,
      });

      await prisma.bulkEditJobOutbox.update({
        where: { id: item.id },
        data: {
          status: "DISPATCHED",
          dispatchedAt: new Date(),
          lastError: null,
        },
      });
      dispatched += 1;
    } catch (error) {
      await prisma.bulkEditJobOutbox.update({
        where: { id: item.id },
        data: {
          status: "FAILED_RETRYABLE",
          lastError: error.message || "Bulk edit enqueue failed",
        },
      });

      logger.error("Bulk edit outbox dispatch failed", {
        outboxId: item.id,
        shop: item.shop,
        editHistoryId: item.editHistoryId,
        message: error.message,
      });
    }
  }

  return { scanned: pending.length, dispatched };
}
