import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import { Services } from "../../services/productService/productFilterService.js";
import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";
import { productSyncQueue } from "../Queues/productSyncQueue.js";
import { prisma } from "../../config/database.js";
import shopify from "../../shopify.js";
import dotenv from "dotenv";
dotenv.config();

const service = new Services();
async function acquireShopLock(shopUrl, ttlSeconds = 600) {
  const key = `lock:product_sync:${shopUrl}`;
  // SET NX EX — atomic: only sets if key does not exist
  const result = await connection.set(key, "1", "EX", ttlSeconds, "NX");
  return result === "OK";
}

async function releaseShopLock(shopUrl) {
  const key = `lock:product_sync:${shopUrl}`;
  await connection.del(key);
}
async function syncAllStoresBatched() {
  const batchSize = 20;
  let lastId = null;

  while (true) {
    const stores = await prisma.store.findMany({
      where: {
        isUnInstalled: false,
      },
      select: {
        id: true,
        shopUrl: true,
      },
      orderBy: {
        id: "asc",
      },
      take: batchSize,
      ...(lastId && {
        cursor: { id: lastId },
        skip: 1,
      }),
    });

    if (stores.length === 0) break;

    for (const store of stores) {
      await syncStore(store.shopUrl);
    }

    lastId = stores[stores.length - 1].id;
  }
}

export const productSyncWorker = new Worker(
  "product-sync-queue",
  async (job) => {
    const { shopUrl, type } = job.data;

    try {
      if (type === "auto-sync") {
        await handleAutoSync();
      } else if (type === "priority-sync") {
        await handlePrioritySync();
      } else if (shopUrl) {
        await syncStore(shopUrl);
      } else {
        await syncAllStoresBatched();
      }
    } catch (error) {
      console.error(`❌ Job ${job.id} failed:`, error?.message || error);
      throw error;
    }
  },
  {
    connection,
    concurrency: 3,
    limiter: {
      max: 10,
      duration: 60000,
    },
  },
);

async function handleAutoSync() {
  const now = new Date();
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

  const storesToSync = await prisma.store.findMany({
    where: {
      isUnInstalled: false,
      isProductSyncing: false,
      OR: [
        { lastProductSyncAt: { lt: sixHoursAgo } },
        { lastProductSyncAt: null },
      ],
    },
    select: {
      shopUrl: true,
    },
    orderBy: {
      lastProductSyncAt: "asc",
    },
    take: 10,
  });

  for (let i = 0; i < storesToSync.length; i++) {
    const store = storesToSync[i];
    const delayMs = i * 30_000;

    await productSyncQueue.add(
      "auto-sync-job",
      { shopUrl: store.shopUrl },
      {
        delay: delayMs,
        jobId: `sync-${store.shopUrl}-${Date.now()}`,
      },
    );
  }
}

async function handlePrioritySync() {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const activeStores = await prisma.store.findMany({
    where: {
      isUnInstalled: false,
      isProductSyncing: false,
      lastProductSyncAt: { lt: twoHoursAgo },
      OR: [{ lastActivityAt: { gt: twoHoursAgo } }],
    },
    select: {
      shopUrl: true,
    },
    take: 5,
  });

  for (const store of activeStores) {
    await productSyncQueue.add(
      "priority-sync-job",
      { shopUrl: store.shopUrl },
      {
        priority: 1,
        jobId: `priority-sync-${store.shopUrl}-${Date.now()}`,
      },
    );
  }
}

async function syncStore(shopUrl) {
  const lockAcquired = await acquireShopLock(shopUrl);
  if (!lockAcquired) {
    console.log(`[worker:sync_locked] shop=${shopUrl} reason=lock_not_acquired`);
    return;
  }


  try {
    const store = await prisma.store.findUnique({
      where: { shopUrl },
      select: {
        isProductSyncing: true,
      },
    });

    if (store?.isProductSyncing) {
      console.log(`[worker:sync_skipped] shop=${shopUrl} reason=already_syncing`);

      return;
    }

    const session = await restoreSession(shopUrl);
    if (!session) {
      console.warn(`⚠️ No offline session found for shop ${shopUrl}, skipping sync`);
      return;
    }

    const currentBulkOperation = await getCurrentBulkOperationStatus(
      session,
      "QUERY",
    );

    if (currentBulkOperation?.status === "RUNNING") {
      console.log(`[worker:sync_skipped] shop=${shopUrl} reason=bulk_op_running bulkOpId=${currentBulkOperation.id}`);

      return;
    }
    console.log(`[worker:sync_start] shop=${shopUrl}`);

    await service.startBulkOperationToFetchProducts({
      session,
      isInitialSync: false,
    });
    console.log(`[worker:sync_triggered] shop=${shopUrl}`);

  } catch (error) {
    console.error(`❌ Error syncing ${shopUrl}:`, error?.message || error);
  }
  finally {
    await releaseShopLock(shopUrl);  // ← always release, even on error
  }
}

async function restoreSession(shop) {
  try {
    const sessionId = `offline_${shop}`;
    const session = await shopify.config.sessionStorage.loadSession(sessionId);

    if (!session) {
      return null;
    }

    return session;
  } catch (err) {
    console.error("❌ Error restoring session for", shop, ":", err?.message || err);
    return null;
  }
}

productSyncWorker.on("completed", (job) => {
  console.log(`✅ Job ${job.id} completed`);
});

productSyncWorker.on("failed", (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err?.message || err);
});

productSyncWorker.on("error", (err) => {
  console.error("❌ Worker error:", err);
});