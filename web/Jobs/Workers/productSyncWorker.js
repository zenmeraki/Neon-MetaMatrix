import { Worker } from "bullmq";
import dotenv from "dotenv";
import { connection } from "../../Config/redis.js";
import { prisma } from "../../config/database.js";
import { Services } from "../../services/productService/productFilterService.js";
import shopify from "../../shopify.js";
import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";
import { withAdvisoryLock } from "../../utils/idempotencyUtils.js";
import { productSyncQueue } from "../Queues/productSyncQueue.js";
import logger from "../../utils/loggerUtils.js";
import {
  RetryableWorkerError,
  assertShopActiveForWorker,
  isSkippableWorkerError,
} from "../../services/workerSafetyService.js";

dotenv.config();

const service = new Services();
const QUEUE_NAME = "product-sync-queue";

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

  for (let index = 0; index < storesToSync.length; index += 1) {
    const store = storesToSync[index];
    const delayMs = index * 30_000;

    await productSyncQueue.add(
      "auto-sync-job",
      { shopUrl: store.shopUrl },
      {
        delay: delayMs,
        jobId: `sync-${store.shopUrl}`,
      },
    );
  }
}

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
        jobId: `priority-sync-${store.shopUrl}`,
      },
    );
  }
}

async function restoreSession(shop) {
  const sessionId = `offline_${shop}`;
  const session = await shopify.config.sessionStorage.loadSession(sessionId);
  return session || null;
}

async function syncStore(shopUrl) {
  const store = await assertShopActiveForWorker(shopUrl);
  const existingSync = await prisma.syncHistory.findFirst({
    where: {
      shop: shopUrl,
      operationType: "Product",
      status: "processing",
    },
    select: {
      id: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (store?.isProductSyncing || existingSync) {
    return {
      skipped: true,
      reason: "local_sync_in_progress",
      shopUrl,
    };
  }

  const { locked, result } = await withAdvisoryLock(
    `product-sync-worker:${shopUrl}`,
    async () => {
      const session = await restoreSession(shopUrl);
      if (!session) {
        throw new RetryableWorkerError(
          `No offline session found for shop ${shopUrl}`,
          "missing_offline_session",
        );
      }

      const { status } = await getCurrentBulkOperationStatus(session, "QUERY");
      if (status === "RUNNING") {
        throw new RetryableWorkerError(
          "Another Shopify query bulk operation is already running",
          "shopify_bulk_busy",
        );
      }

      return service.startBulkOperationToFetchProducts({ session });
    },
  );

  if (!locked) {
    throw new RetryableWorkerError(
      `Product sync already in progress for ${shopUrl}`,
      "product_sync_worker_lock_conflict",
    );
  }

  return result;
}

export const productSyncWorker = new Worker(
  QUEUE_NAME,
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
      if (isSkippableWorkerError(error)) {
        logger.info("Product sync worker skipped job", {
          worker: "productSyncWorker",
          queue: QUEUE_NAME,
          jobId: job.id,
          shop: shopUrl || null,
          type: type || null,
          reason: error.code,
          message: error.message,
        });
        return {
          skipped: true,
          reason: error.code,
        };
      }

      logger.error("Product sync worker failed", {
        worker: "productSyncWorker",
        queue: QUEUE_NAME,
        jobId: job.id,
        shop: shopUrl || null,
        type: type || null,
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

productSyncWorker.on("completed", (job) => {
  logger.info("Product sync worker completed", {
    worker: "productSyncWorker",
    queue: QUEUE_NAME,
    jobId: job.id,
    shop: job.data?.shopUrl || null,
    type: job.data?.type || null,
  });
});

productSyncWorker.on("failed", (job, error) => {
  logger.error("Product sync worker failed event", {
    worker: "productSyncWorker",
    queue: QUEUE_NAME,
    jobId: job?.id,
    shop: job?.data?.shopUrl || null,
    type: job?.data?.type || null,
    message: error?.message || String(error),
  });
});

productSyncWorker.on("error", (error) => {
  logger.error("Product sync worker error", {
    worker: "productSyncWorker",
    queue: QUEUE_NAME,
    message: error?.message || String(error),
  });
});
