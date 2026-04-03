import { prisma } from "../config/database.js";
import { addProductReconcileJob } from "../Jobs/Queues/productReconcileJob.js";
import { addShopSyncJob } from "../Jobs/Queues/shopSyncJob.js";
import { purgeExpiredProductTombstones } from "../services/mirrorFreshnessService.js";
import logger from "../utils/loggerUtils.js";

const SCHEDULE_INTERVAL_MS = 10 * 60 * 1000;
const INCREMENTAL_REPAIR_STALE_MS = 30 * 60 * 1000;
const FULL_REPAIR_STALE_MS = 12 * 60 * 60 * 1000;

async function queueRepairWork() {
  const now = Date.now();
  const incrementalStaleBefore = new Date(now - INCREMENTAL_REPAIR_STALE_MS);
  const fullRepairStaleBefore = new Date(now - FULL_REPAIR_STALE_MS);

  const stores = await prisma.store.findMany({
    where: {
      isUnInstalled: false,
      activeMirrorBatchId: { not: null },
      OR: [
        { repairRequired: true },
        { lastIncrementalSyncAt: null },
        { lastIncrementalSyncAt: { lt: incrementalStaleBefore } },
      ],
    },
    select: {
      shopUrl: true,
      repairRequired: true,
      lastFullSyncAt: true,
      lastIncrementalSyncAt: true,
      isProductSyncing: true,
    },
    take: 50,
    orderBy: {
      lastIncrementalSyncAt: "asc",
    },
  });

  let incrementalQueued = 0;
  let bulkQueued = 0;

  for (const store of stores) {
    if (store.isProductSyncing) {
      continue;
    }

    const needsBulkRepair =
      store.repairRequired ||
      !store.lastFullSyncAt ||
      store.lastFullSyncAt < fullRepairStaleBefore;

    if (needsBulkRepair) {
      await addShopSyncJob({
        shop: store.shopUrl,
        syncType: "product",
        reason: "scheduled_mirror_repair",
      }).catch(() => {});
      bulkQueued += 1;
      continue;
    }

    await addProductReconcileJob({
      shop: store.shopUrl,
      mode: "shop_incremental",
    }).catch(() => {});
    incrementalQueued += 1;
  }

  const tombstonesPurged = await purgeExpiredProductTombstones().catch(() => 0);

  return {
    scanned: stores.length,
    incrementalQueued,
    bulkQueued,
    tombstonesPurged,
  };
}

async function runSchedulerTick() {
  try {
    const result = await queueRepairWork();
    if (result.scanned || result.tombstonesPurged) {
      logger.info("Product reconcile repair scheduler tick completed", result);
    }
  } catch (error) {
    logger.error("Product reconcile repair scheduler tick failed", {
      error: error.message,
      stack: error.stack,
    });
  }
}

if (!globalThis.__productReconcileRepairSchedulerStarted) {
  globalThis.__productReconcileRepairSchedulerStarted = true;
  setTimeout(runSchedulerTick, 45_000);
  setInterval(runSchedulerTick, SCHEDULE_INTERVAL_MS);
}
