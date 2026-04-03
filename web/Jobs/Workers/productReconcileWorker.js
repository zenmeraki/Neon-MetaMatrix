import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import logger from "../../utils/loggerUtils.js";
import {
  acquireExclusiveShopWork,
  releaseExclusiveShopWork,
} from "../../services/shopWorkLeaseService.js";
import {
  RetryableWorkerError,
  assertShopActiveForWorker,
  isRetryableWorkerError,
  isSkippableWorkerError,
} from "../../services/workerSafetyService.js";
import {
  maybeEscalateMirrorRepair,
  processProductReconcileSignal,
  runIncrementalReconcile,
} from "../../services/productService/productReconcileService.js";
import { addProductReconcileJob } from "../Queues/productReconcileJob.js";

const QUEUE_NAME =
  process.env.NODE_ENV === "production"
    ? "product-reconcile"
    : "product-reconcile-job-dev";

async function runWithShopSerialization({ shop, job, activity, fn }) {
  const exclusiveLock = await acquireExclusiveShopWork({
    shop,
    activity,
    worker: "productReconcileWorker",
    queue: QUEUE_NAME,
    jobId: job.id,
    entityType: "store",
    entityId: shop,
    executionId: `${activity}:${shop}`,
  });

  if (!exclusiveLock.acquired) {
    throw new RetryableWorkerError(
      "Another heavy mirror job is already running for this shop",
      "shop_work_conflict",
    );
  }

  try {
    return await fn();
  } finally {
    await releaseExclusiveShopWork(exclusiveLock.lockKey);
  }
}

const productReconcileWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { shop, productId, mode = "product", updatedSinceOverride = null } = job.data || {};
    if (!shop) {
      throw new Error("product-reconcile job requires shop");
    }

    try {
      await assertShopActiveForWorker(shop);

      if (mode === "shop_incremental") {
        return runWithShopSerialization({
          shop,
          job,
          activity: "product_incremental_reconcile",
          fn: () => runIncrementalReconcile({ shop, updatedSinceOverride }),
        });
      }

      if (!productId) {
        throw new Error("product-reconcile product mode requires productId");
      }

      const result = await runWithShopSerialization({
        shop,
        job,
        activity: "product_direct_reconcile",
        fn: () =>
          processProductReconcileSignal({
            shop,
            productId,
            emitAutomaticRuleSignal: true,
          }),
      });

      if (result?.needsFollowUp) {
        await addProductReconcileJob({
          shop,
          productId,
          mode: "product",
        }).catch(() => {});
      }

      return result;
    } catch (error) {
      if (isSkippableWorkerError(error)) {
        return {
          skipped: true,
          reason: error.code,
          shop,
          productId: productId || null,
        };
      }

      if (!isRetryableWorkerError(error)) {
        await maybeEscalateMirrorRepair({
          shop,
          error,
          details: {
            jobId: job.id,
            mode,
            productId: productId || null,
          },
        }).catch(() => {});
      }

      throw error;
    }
  },
  {
    connection,
    concurrency: 5,
  },
);

productReconcileWorker.on("completed", (job, result) => {
  logger.info("Product reconcile worker completed", {
    worker: "productReconcileWorker",
    queue: QUEUE_NAME,
    jobId: job?.id,
    shop: job?.data?.shop,
    mode: job?.data?.mode || "product",
    productId: job?.data?.productId || null,
    result,
  });
});

productReconcileWorker.on("failed", (job, error) => {
  logger.error("Product reconcile worker failed", {
    worker: "productReconcileWorker",
    queue: QUEUE_NAME,
    jobId: job?.id,
    shop: job?.data?.shop,
    mode: job?.data?.mode || "product",
    productId: job?.data?.productId || null,
    message: error?.message || String(error),
  });
});

export default productReconcileWorker;
