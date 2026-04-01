// ============================================
// Jobs/Workers/productSyncWorker.js
// ============================================
import { Worker } from "bullmq";
import dotenv from "dotenv";
import { connection } from "../../Config/redis.js";
import { prisma } from "../../config/database.js";
import { productSyncQueue } from "../Queues/productSyncQueue.js";
import { Services } from "../../services/productService/productFilterService.js";
import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";
import logger from "../../utils/loggerUtils.js";
import shopify from "../../shopify.js";

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
    const { shopUrl, type } = job.data || {};

    try {
      if (type === "auto-sync") {
        await handleAutoSync();
      } else if (type === "priority-sync") {
        await handlePrioritySync();
      } else if (shopUrl) {
        await syncStore(shopUrl);
      } else {
        throw new Error(
          "product sync job requires either a scheduler type or shopUrl",
        );
      }
    } catch (error) {
      logger.error("Product sync worker job failed", {
        jobId: job.id,
        type: type || null,
        shopUrl: shopUrl || null,
        message: error?.message || String(error),
      });
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

  for (let i = 0; i < storesToSync.length; i += 1) {
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

// ============================================
// PRIORITY SYNC HANDLER - Every 2 hours (Prisma)
// ============================================
async function handlePrioritySync() {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const activeStores = await prisma.store.findMany({
    where: {
      isUnInstalled: false,
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

// ============================================
// SYNC INDIVIDUAL STORE
// ============================================
async function syncStore(shopUrl) {
  try {
    if (!shopUrl) {
      throw new Error("Missing shopUrl for product sync");
    }

    const store = await prisma.store.findFirst({
      where: {
        shopUrl,
        isUnInstalled: false,
      },
      select: {
        shopUrl: true,
      },
    });

    if (!store) {
      logger.warn("Skipping product sync for unknown or uninstalled shop", {
        shopUrl,
      });
      return;
    }

    const session = await restoreSession(store.shopUrl);
    if (!session) {
      logger.warn("No offline session found for shop, skipping sync", {
        shopUrl: store.shopUrl,
      });
      return;
    }

    const { status } = await getCurrentBulkOperationStatus(session, "QUERY");
    if (status === "RUNNING") {
      return;
    }

    await service.startBulkOperationToFetchProducts({ session });
  } catch (error) {
    logger.error("Error syncing shop products", {
      shopUrl,
      message: error?.message || String(error),
    });
  }
}

// ============================================
// RESTORE SESSION from PostgreSQLSessionStorage
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
    logger.error("Error restoring offline Shopify session", {
      shop,
      message: err?.message || String(err),
    });
    return null;
  }
}

// ============================================
// WORKER EVENT HANDLERS
// ============================================
productSyncWorker.on("completed", (job) => {
  logger.info("Product sync worker job completed", {
    jobId: job.id,
    type: job.data?.type || null,
    shopUrl: job.data?.shopUrl || null,
  });
});

productSyncWorker.on("failed", (job, err) => {
  logger.error("Product sync worker job failed", {
    jobId: job?.id || null,
    type: job?.data?.type || null,
    shopUrl: job?.data?.shopUrl || null,
    message: err?.message || String(err),
  });
});

productSyncWorker.on("error", (err) => {
  logger.error("Product sync worker error", {
    message: err?.message || String(err),
  });
});

export { syncAllStoresBatched };
