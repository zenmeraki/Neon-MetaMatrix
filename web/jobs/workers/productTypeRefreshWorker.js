import { Worker } from "bullmq";
import { connection } from "../../config/redis.js";
import { refreshProductTypesForShop } from "../../controllers/productSyncController.js";
import logger from "../../utils/loggerUtils.js";

const QUEUE_NAME = process.env.PRODUCT_TYPE_REFRESH_QUEUE || "productTypeRefresh";

const productTypeRefreshWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const shop = String(job?.data?.shop || "").trim();
    const force = job?.data?.force === true;
    if (!shop) {
      throw new Error("PRODUCT_TYPE_REFRESH_JOB_SHOP_MISSING");
    }
    await refreshProductTypesForShop({ shop, force });
  },
  {
    connection,
    concurrency: 1,
    lockDuration: 120_000,
  },
);

productTypeRefreshWorker.on("completed", (job) => {
  logger.info("[productTypeRefreshWorker] completed", {
    jobId: job.id,
    shop: job?.data?.shop || null,
  });
});

productTypeRefreshWorker.on("failed", (job, error) => {
  logger.error("[productTypeRefreshWorker] failed", {
    jobId: job?.id,
    shop: job?.data?.shop || null,
    error: error?.message,
  });
});

export default productTypeRefreshWorker;

