import { Worker } from "bullmq";
import { connection } from "../../config/redis.js";
import { sendEmail } from "../../utils/emailHelper.js";
import { uninstallFeedbackHTML } from "../../config/templates/uninstallTemplate.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { logWebhookError } from "../../utils/errorLogUtils.js";
import { prisma } from "../../config/database.js";
import logger from "../../utils/loggerUtils.js";
import { shopUninstallCleanupService } from "../../services/shopUninstallCleanupService.js";
import { webhookDeliveryRepository } from "../../repositories/webhookDeliveryRepository.js";

const QUEUE_NAME = "appUninstall";

const appUninstallWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const shop = job.data?.shop;
    const deliveryId = job.data?.deliveryId || job.data?.webhookId || null;
    if (!shop) {
      throw new Error("app-uninstall job requires shop");
    }

    try {
      if (deliveryId) {
        const claimed = await prisma.webhookDelivery.updateMany({
          where: {
            id: deliveryId,
            topic: "APP_UNINSTALLED",
            status: { in: ["RECEIVED", "QUEUED", "FAILED"] },
          },
          data: {
            status: "PROCESSING",
            lastError: null,
            updatedAt: new Date(),
          },
        });

        if (claimed.count !== 1) {
          await webhookDeliveryRepository.markSkipped(
            deliveryId,
            "APP_UNINSTALLED_DUPLICATE_IGNORED",
          ).catch(() => {});

          return {
            skipped: true,
            reason: "duplicate_delivery",
            shop,
            deliveryId,
          };
        }
      }

      const store = await prisma.store.findUnique({
        where: { shopUrl: shop },
        select: {
          shopEmail: true,
          isUnInstalled: true,
        },
      });

      if (!store) {
        if (deliveryId) {
          await webhookDeliveryRepository.markSkipped(
            deliveryId,
            "STORE_NOT_FOUND",
          ).catch(() => {});
        }
        return {
          skipped: true,
          reason: "store_not_found",
          shop,
        };
      }

      if (store.isUnInstalled) {
        if (deliveryId) {
          await webhookDeliveryRepository.markSkipped(
            deliveryId,
            "ALREADY_UNINSTALLED",
          ).catch(() => {});
        }
        return {
          skipped: true,
          reason: "already_uninstalled",
          shop,
        };
      }

      const cleanupResult = await shopUninstallCleanupService.cleanupShop(shop);

      if (store.shopEmail) {
        await sendEmail(
          store.shopEmail,
          "Your feedback would mean the world to us",
          uninstallFeedbackHTML("Metamatrix User", shop, shop.split(".")[0]),
          true,
        );
      }

      await clearKeyCaches(`${shop}`);

      if (deliveryId) {
        await webhookDeliveryRepository.markProcessed(deliveryId).catch(() => {});
      }

      logger.info("App uninstall background job completed", {
        worker: "appUninstallWorker",
        jobId: job.id,
        shop,
        cleanupResult,
      });

      return {
        success: true,
        shop,
        deliveryId,
      };
    } catch (error) {
      if (deliveryId) {
        await webhookDeliveryRepository.markFailed(deliveryId, error).catch(() => {});
      }
      await logWebhookError({
        shop,
        err: error,
        source: "appUninstallWorker",
        req: job.data,
      });
      throw error;
    }
  },
  {
    connection,
    concurrency: 1,
  },
);

appUninstallWorker.on("failed", (job, error) => {
  logger.error("App uninstall worker failed", {
    worker: "appUninstallWorker",
    jobId: job?.id,
    shop: job?.data?.shop,
    message: error.message,
  });
});

export default appUninstallWorker;
