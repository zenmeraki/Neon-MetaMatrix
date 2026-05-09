import { connection } from "../config/redis.js";
import { prisma } from "../config/database.js";
import { clearKeyCaches } from "../utils/cacheUtils.js";
import { transitionOperation } from "./operationTransitionService.js";
import {
  OPERATION_QUEUE_NAMES,
  getOperationQueue,
} from "../jobs/queues/operationQueueRegistry.js";

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

    const activeOperations = await prisma.merchantOperation.findMany({
      where: {
        shop,
        status: {
          in: [
            "PLANNED",
            "SNAPSHOTTING",
            "SNAPSHOTTED",
            "DISPATCHING",
            "AWAITING_SHOPIFY",
            "APPLYING_RESULTS",
          ],
        },
      },
      select: { id: true, status: true },
    });
    let transitionedCount = 0;
    for (const operation of activeOperations) {
      try {
        if (["PLANNED", "SNAPSHOTTED"].includes(operation.status)) {
          await transitionOperation({
            shop,
            operationId: operation.id,
            from: operation.status,
            to: "CANCELLED",
            data: {
              completedAt: new Date(),
              errorCode: "SHOP_UNINSTALLED",
              errorMessage: "Shop uninstalled before operation completed.",
            },
          });
        } else {
          await transitionOperation({
            shop,
            operationId: operation.id,
            from: operation.status,
            to: "FAILED",
            data: {
              failedAt: new Date(),
              errorCode: "SHOP_UNINSTALLED",
              errorMessage: "Shop uninstalled before operation completed.",
            },
          });
        }
        transitionedCount += 1;
      } catch (_error) {}
    }

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
      cancelledOperations: transitionedCount,
      removedJobs,
      clearedLocks,
      queues: queueResults,
    };
  },
};
