import { connection } from "../Config/redis.js";
import { prisma } from "../config/database.js";
import { clearKeyCaches } from "../utils/cacheUtils.js";
import {
  OPERATION_QUEUE_NAMES,
  getOperationQueue,
} from "../Jobs/Queues/operationQueueRegistry.js";

const JOB_STATES_TO_REMOVE = [
  "waiting",
  "delayed",
  "prioritized",
  "active",
  "paused",
];

function jobBelongsToShop(job, shop) {
  return job?.data?.shop === shop || job?.data?.shopUrl === shop || job?.data?.shopId === shop;
}

async function removeShopJobsFromQueue(queue, shop) {
  let removed = 0;

  for (const state of JOB_STATES_TO_REMOVE) {
    const jobs = await queue.getJobs([state], 0, 1000, true);

    for (const job of jobs) {
      if (!jobBelongsToShop(job, shop)) continue;
      await job.remove().catch(() => {});
      removed += 1;
    }
  }

  return removed;
}

async function clearShopLocks(shop) {
  const patterns = [
    `lock:*:${shop}`,
    `lock:*:${shop}:*`,
    `shop:${shop}:ops_per_minute`,
  ];
  let deleted = 0;

  for (const pattern of patterns) {
    let cursor = "0";

    do {
      const [nextCursor, keys] = await connection.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        500,
      );
      cursor = nextCursor;

      if (keys.length) {
        deleted += await connection.unlink(...keys);
      }
    } while (cursor !== "0");
  }

  return deleted;
}

export const shopUninstallCleanupService = {
  async cleanupShop(shop) {
    if (!shop) {
      throw new Error("shop is required for uninstall cleanup");
    }

    const now = new Date();
    const cancelledOperations = await prisma.storeOperation.updateMany({
      where: {
        shop,
        status: { in: ["QUEUED", "CLAIMED", "RUNNING", "FINALIZING"] },
      },
      data: {
        status: "CANCELLED",
        failedAt: now,
        errorCode: "SHOP_UNINSTALLED",
        errorMessage: "Shop uninstalled before operation completed.",
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: now,
      },
    });

    await prisma.storeOperationalState
      .updateMany({
        where: { shop },
        data: {
          activeWriteOperationId: null,
          activeSyncOperationId: null,
          activeImportOperationId: null,
          writeBlockedReason: "SHOP_UNINSTALLED",
          writesBlockedUntil: null,
        },
      })
      .catch(() => {});

    const queueResults = await Promise.all(
      Object.values(OPERATION_QUEUE_NAMES).map(async (queueName) => {
        const removed = await removeShopJobsFromQueue(getOperationQueue(queueName), shop);
        return { queueName, removed };
      }),
    );

    const removedJobs = queueResults.reduce((sum, result) => sum + result.removed, 0);
    const clearedLocks = await clearShopLocks(shop);
    await clearKeyCaches(`${shop}`);

    return {
      cancelledOperations: cancelledOperations.count,
      removedJobs,
      clearedLocks,
      queues: queueResults,
    };
  },
};
