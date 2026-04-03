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

const QueueName =
  process.env.NODE_ENV === "production"
    ? "product-update"
    : "product-update-job-dev";

const productUpdateWorker = new Worker(
  QueueName,
  async (job) => {
    const { shop, id, webhookId, ...payload } = job.data || {};

    try {
      if (!shop || !id) {
        throw new Error("product-update job requires shop and id");
      }

      await assertShopActiveForWorker(shop);

      await recordProductReconcileSignal({
        shop,
        productId: id,
        topic: "PRODUCTS_UPDATE",
        webhookId: webhookId || null,
        sourceUpdatedAt: payload.updated_at || payload.created_at || null,
        sourceEventAt: getWebhookEventTimestamp(payload, job.timestamp),
        sourceKind: MIRROR_SOURCE_KINDS.WEBHOOK_UPDATE,
      });

      await addProductReconcileJob({
        shop,
        productId: id,
        mode: "product",
        topic: "PRODUCTS_UPDATE",
        webhookId: webhookId || null,
      });

      return { forwarded: true, productId: id };
    } catch (err) {
      if (isSkippableWorkerError(err)) {
        return {
          skipped: true,
          reason: err.code,
        };
      }

      await recordMirrorAnomaly({
        shop: shop || "unknown",
        severity: "high",
        type: "product_update_forward_failure",
        entityType: "product",
        entityId: id || null,
        message: err.message,
      }).catch(() => {});
      throw err;
    }
  },
  {
    connection,
    concurrency: 5,
  },
);

productUpdateWorker.on("failed", (job, err) => {
  logger.error("productUpdateWorker failed", {
    worker: "productUpdateWorker",
    jobId: job?.id,
    shop: job?.data?.shop,
    productId: job?.data?.id,
    message: err?.message || String(err),
  });
});

export default productUpdateWorker;
