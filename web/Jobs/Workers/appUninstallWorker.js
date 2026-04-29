import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import { sendEmail } from "../../utils/emailHelper.js";
import { uninstallFeedbackHTML } from "../../Config/templates/uninstallTemplate.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { logWebhookError } from "../../utils/errorLogUtils.js";
import { prisma } from "../../config/database.js";
import logger from "../../utils/loggerUtils.js";
import { shopUninstallCleanupService } from "../../services/shopUninstallCleanupService.js";

const QUEUE_NAME = "appUninstall";

const appUninstallWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const shop = job.data?.shop;
    if (!shop) {
      throw new Error("app-uninstall job requires shop");
    }

    try {
      const store = await prisma.store.findUnique({
        where: { shopUrl: shop },
        select: {
          shopEmail: true,
          isUnInstalled: true,
        },
      });

      if (!store) {
        return {
          skipped: true,
          reason: "store_not_found",
          shop,
        };
      }

      if (store.isUnInstalled) {
        return {
          skipped: true,
          reason: "already_uninstalled",
          shop,
        };
      }

      const editHistoryIds = await prisma.editHistory.findMany({
        where: { shop },
        select: { id: true },
      });

      const historyIdList = editHistoryIds.map((record) => record.id);
      const cleanupResult = await shopUninstallCleanupService.cleanupShop(shop);

      await prisma.$transaction(async (tx) => {
        if (historyIdList.length) {
          await tx.changeRecord.deleteMany({
            where: {
              editHistoryId: { in: historyIdList },
              shop,
            },
          });
        }

        await tx.variant.deleteMany({ where: { shop } });
        await tx.product.deleteMany({ where: { shop } });
        await tx.exportHistory.deleteMany({ where: { shop } });
        await tx.collection.deleteMany({ where: { shop } });
        await tx.syncHistory.deleteMany({ where: { shop } });
        await tx.editHistory.deleteMany({ where: { shop } });
        await tx.exportJob.deleteMany({ where: { shop } });
        await tx.automaticProductRuleProductState.deleteMany({ where: { shop } });
        await tx.automaticProductRuleRun.deleteMany({ where: { shop } });
        await tx.automaticProductRule.deleteMany({ where: { shop } });
        await tx.recurringEditRun.deleteMany({ where: { shop } });
        await tx.recurringEdit.deleteMany({ where: { shop } });
        await tx.scheduledExportRun.deleteMany({ where: { shop } });
        await tx.scheduledExport.deleteMany({ where: { shop } });
        await tx.store.update({
          where: { shopUrl: shop },
          data: {
            isUnInstalled: true,
            unInstalledAt: new Date(),
            isProductSyncing: false,
            isCollectionSyncing: false,
            isProductTypeSyncing: false,
            isProductInitialySyning: false,
          },
        });
      });

      if (store.shopEmail) {
        await sendEmail(
          store.shopEmail,
          "Your feedback would mean the world to us",
          uninstallFeedbackHTML("Metamatrix User", shop, shop.split(".")[0]),
          true,
        );
      }

      await clearKeyCaches(`${shop}`);

      logger.info("App uninstall background job completed", {
        worker: "appUninstallWorker",
        jobId: job.id,
        shop,
        cleanupResult,
      });

      return {
        success: true,
        shop,
      };
    } catch (error) {
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
