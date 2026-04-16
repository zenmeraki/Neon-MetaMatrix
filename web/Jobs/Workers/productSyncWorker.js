import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import { productSyncQueue } from "../Queues/productSyncQueue.js";
import { prisma } from "../../Config/database.js";
import shopify from "../../shopify.js";
import { startProductCatalogSync } from "../../services/sync/catalogSyncService.js";
import dotenv from "dotenv";

dotenv.config();

const QUEUE_NAME = "product-sync-queue";
const WORKER_NAME = "productSyncWorker";
const SHOP_SYNC_LOCK_TTL_MS = 30 * 60 * 1000;

function buildShopSyncJobId(shopUrl) {
  const safeShop = String(shopUrl).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `product-sync-${safeShop}`;
}

function buildShopSyncLockKey(shopUrl) {
  return `lock:product-sync:${shopUrl}`;
}

async function enqueueShopSync(shopUrl, options = {}) {
  if (!shopUrl) {
    return null;
  }

  return productSyncQueue.add(
    "product-sync-shop",
    { shopUrl },
    {
      ...options,
      jobId: buildShopSyncJobId(shopUrl),
    },
  );
}

async function acquireShopSyncLock(shopUrl, jobId) {
  const token = `${WORKER_NAME}:${jobId || "unknown"}:${Date.now()}:${Math.random()
    .toString(36)
    .slice(2)}`;
  const acquired = await connection.set(
    buildShopSyncLockKey(shopUrl),
    token,
    "PX",
    SHOP_SYNC_LOCK_TTL_MS,
    "NX",
  );

  return acquired === "OK" ? { shopUrl, token } : null;
}

async function releaseShopSyncLock(lock) {
  if (!lock?.shopUrl || !lock?.token) {
    return;
  }

  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    end
    return 0
  `;

  await connection
    .eval(script, 1, buildShopSyncLockKey(lock.shopUrl), lock.token)
    .catch(() => {});
}

async function enqueueAllStoresBatched() {
  const batchSize = 20;
  let lastId = null;
  let enqueued = 0;

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

    if (stores.length === 0) {
      break;
    }

    for (const store of stores) {
      await enqueueShopSync(store.shopUrl);
      enqueued += 1;
    }

    lastId = stores[stores.length - 1].id;
  }

  return { enqueued };
}

export const productSyncWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { shopUrl, type } = job.data || {};

    try {
      if (type === "auto-sync") {
        return await handleAutoSync();
      }

      if (type === "priority-sync") {
        return await handlePrioritySync();
      }

      if (shopUrl) {
        return await syncStore(shopUrl, job);
      }

      return await enqueueAllStoresBatched();
    } catch (error) {
      console.error(`Product sync job ${job.id} failed:`, error?.message || error);
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

  for (let i = 0; i < storesToSync.length; i += 1) {
    await enqueueShopSync(storesToSync[i].shopUrl, { delay: i * 30_000 });
  }

  return { enqueued: storesToSync.length };
}

async function handlePrioritySync() {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const activeStores = await prisma.store.findMany({
    where: {
      isUnInstalled: false,
      isProductSyncing: false,
      lastProductSyncAt: { lt: twoHoursAgo },
      lastActivityAt: { gt: twoHoursAgo },
    },
    select: {
      shopUrl: true,
    },
    take: 5,
  });

  for (const store of activeStores) {
    await enqueueShopSync(store.shopUrl, { priority: 1 });
  }

  return { enqueued: activeStores.length };
}

async function syncStore(shopUrl, job) {
  let lock = null;

  try {
    lock = await acquireShopSyncLock(shopUrl, job?.id);
    if (!lock) {
      return { skipped: true, reason: "shop_sync_locked", shopUrl };
    }

    const store = await prisma.store.findUnique({
      where: { shopUrl },
      select: {
        shopUrl: true,
        isUnInstalled: true,
      },
    });

    if (!store || store.isUnInstalled) {
      return { skipped: true, reason: "store_not_syncable", shopUrl };
    }

    const session = await restoreSession(shopUrl);
    if (!session) {
      return { skipped: true, reason: "offline_session_missing", shopUrl };
    }

    const result = await startProductCatalogSync({
      shop: shopUrl,
      session,
      force: false,
      isInitialSync: false,
    });

    return { success: true, shopUrl, result };
  } catch (error) {
    console.error(`Error syncing ${shopUrl}:`, error?.message || error);
    throw error;
  } finally {
    await releaseShopSyncLock(lock);
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
    console.error("Error restoring session for", shop, ":", err?.message || err);
    throw err;
  }
}

productSyncWorker.on("completed", (job) => {
  console.log(`Product sync job ${job.id} completed`);
});

productSyncWorker.on("failed", (job, err) => {
  console.error(`Product sync job ${job?.id} failed:`, err?.message || err);
});

productSyncWorker.on("error", (err) => {
  console.error("Product sync worker error:", err);
});
