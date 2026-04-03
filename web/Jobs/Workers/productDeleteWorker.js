import logger from "../../utils/loggerUtils.js";
import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import {
  assertShopActiveForWorker,
  getWebhookEventTimestamp,
  isSkippableWorkerError,
} from "../../services/workerSafetyService.js";
import { recordMirrorAnomaly } from "../../services/mirrorAnomalyService.js";
import { recordProductReconcileSignal } from "../../services/productReconcileSignalService.js";
import { MIRROR_SOURCE_KINDS } from "../../services/mirrorFreshnessService.js";
import { addProductReconcileJob } from "../Queues/productReconcileJob.js";

const QUEUE_NAME =
  process.env.NODE_ENV === "production"
    ? "product-delete"
    : "product-delete-job-dev";

function normalizeProductId(id) {
  if (!id) {
    return null;
  }

  return String(id).startsWith("gid://shopify/Product/")
    ? String(id)
    : `gid://shopify/Product/${id}`;
}

const productDeleteWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const shop = job.data?.shop;
    const productId = normalizeProductId(job.data?.id);

    try {
      if (!shop || !productId) {
        throw new Error("product-delete job requires shop and id");
      }

      await assertShopActiveForWorker(shop);

      await recordProductReconcileSignal({
        shop,
        productId,
        topic: "PRODUCTS_DELETE",
        webhookId: job.data?.webhookId || null,
        sourceUpdatedAt: job.data?.updated_at || job.data?.deleted_at || null,
        sourceEventAt: getWebhookEventTimestamp(job.data, job.timestamp),
        sourceKind: MIRROR_SOURCE_KINDS.WEBHOOK_DELETE,
      });

      await addProductReconcileJob({
        shop,
        productId,
        mode: "product",
        topic: "PRODUCTS_DELETE",
        webhookId: job.data?.webhookId || null,
      });

      return {
        forwarded: true,
        shop,
        productId,
      };
    } catch (error) {
      if (isSkippableWorkerError(error)) {
        return {
          skipped: true,
          reason: error.code,
          shop,
          productId,
        };
      }

      await recordMirrorAnomaly({
        shop: shop || "unknown",
        severity: "high",
        type: "product_delete_forward_failure",
        entityType: "product",
        entityId: productId || null,
        message: error.message,
      }).catch(() => {});
      throw error;
    }
  },
  {
    connection,
    concurrency: 5,
  },
);

productDeleteWorker.on("failed", (job, error) => {
  logger.error("Product delete worker failed", {
    worker: "productDeleteWorker",
    jobId: job?.id,
    shop: job?.data?.shop,
    productId: job?.data?.id,
    message: error?.message || String(error),
  });
});

export default productDeleteWorker;
