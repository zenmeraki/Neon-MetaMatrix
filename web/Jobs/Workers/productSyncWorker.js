// ============================================
// Jobs/Workers/productSyncWorker.js
// ============================================
import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import { Services } from "../../services/productService/productFilterService.js";
import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";
import { productSyncQueue } from "../Queues/productSyncQueue.js";

// 🔹 Use the shared Prisma client (Neon / Postgres)
import { prisma } from "../../Config/database.js";

// 🔹 Use the same Shopify app instance that is configured
//     with PostgreSQLSessionStorage (DATABASE_URL)
import shopify from "../../shopify.js";

import dotenv from "dotenv";
dotenv.config();

const service = new Services();

// ============================================
// SYNC ALL STORES IN BATCHES (Prisma version)
// ============================================
async function syncAllStoresBatched() {
  const batchSize = 20;
  let lastId = null;

  while (true) {
    const stores = await prisma.store.findMany({
      where: {
        // Mongo: $or: [{ isUnInstalled: false }, { isUnInstalled: { $exists: false } }]
        // Prisma: default false, so just filter isUnInstalled === false
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

// ============================================
// WORKER
// ============================================
export const productSyncWorker = new Worker(
  "product-sync-queue",
  async (job) => {
    const { shopUrl, type } = job.data;

    try {
      // Handle scheduler jobs (cron triggers)
      if (type === "auto-sync") {
        await handleAutoSync();
      } else if (type === "priority-sync") {
        await handlePrioritySync();
      }
      // Handle individual store sync jobs
      else if (shopUrl) {
        await syncStore(shopUrl);
      }
      // Backward compatibility - sync all stores
      else {
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

// ============================================
// AUTO SYNC HANDLER - Every 6 hours (Prisma)
// ============================================
async function handleAutoSync() {
  const now = new Date();
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

  const storesToSync = await prisma.store.findMany({
    where: {
      isUnInstalled: false,
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

  // Queue individual store syncs with staggered delays
  for (let i = 0; i < storesToSync.length; i++) {
    const store = storesToSync[i];
    const delayMs = i * 30_000; // 30-second delay between stores

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

// ============================================
// PRIORITY SYNC HANDLER - Every 2 hours (Prisma)
// ============================================
async function handlePrioritySync() {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const activeStores = await prisma.store.findMany({
    where: {
      isUnInstalled: false,
      lastProductSyncAt: { lt: twoHoursAgo },
      OR: [
        { lastActivityAt: { gt: twoHoursAgo } },
        // If you later add `isPremium` Boolean to Store model:
        // { isPremium: true },
      ],
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

// ============================================
// SYNC INDIVIDUAL STORE
// ============================================
async function syncStore(shopUrl) {
  try {
    const session = await restoreSession(shopUrl);
    if (!session) {
      console.warn(`⚠️ No offline session found for shop ${shopUrl}, skipping sync`);
      return;
    }

    const { status } = await getCurrentBulkOperationStatus(session, "QUERY");
    if (status === "RUNNING") {
      // Bulk operation already running, don't start another
      return;
    }

    await service.startBulkOperationToFetchProducts({ session });
  } catch (error) {
    console.error(`❌ Error syncing ${shopUrl}:`, error?.message || error);
  }
}

// ============================================
// RESTORE SESSION – from PostgreSQLSessionStorage
// ============================================
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

// ============================================
// WORKER EVENT HANDLERS
// ============================================
productSyncWorker.on("completed", (job) => {
  console.log(`✅ Job ${job.id} completed`);
});

productSyncWorker.on("failed", (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err?.message || err);
});

productSyncWorker.on("error", (err) => {
  console.error("❌ Worker error:", err);
});