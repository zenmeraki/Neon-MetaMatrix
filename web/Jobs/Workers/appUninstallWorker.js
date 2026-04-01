import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import { sendEmail } from "../../utils/emailHelper.js";
import { uninstallFeedbackHTML } from "../../Config/templates/uninstallTemplate.js";
import { clearAllCachesForShop } from "../../utils/cacheUtils.js";
import { logWebhookError } from "../../utils/errorLogUtils.js";
import { prisma } from "../../config/database.js";
import { clearShopSessions } from "../../utils/sessionHandler.js";
import logger from "../../utils/loggerUtils.js";

const QUEUE_NAME = "appUninstall";

function toDateOrNull(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isReinstalledAfterUninstall({ installedAt, uninstallReceivedAt }) {
  if (!installedAt || !uninstallReceivedAt) {
    return false;
  }

  return new Date(installedAt).getTime() > new Date(uninstallReceivedAt).getTime();
}

const appUninstallWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const shop = job.data?.shop;
    if (!shop) {
      throw new Error("app-uninstall job requires shop");
    }

    const uninstallReceivedAt = toDateOrNull(job.data?.receivedAt) || new Date();

    try {
      const store = await prisma.store.findUnique({
        where: { shopUrl: shop },
        select: {
          shopEmail: true,
          installedAt: true,
          unInstalledAt: true,
        },
      });

      if (!store) {
        return {
          skipped: true,
          reason: "store_not_found",
          shop,
        };
      }

      if (
        isReinstalledAfterUninstall({
          installedAt: store.installedAt,
          uninstallReceivedAt,
        })
      ) {
        await clearAllCachesForShop(shop).catch(() => {});

        return {
          skipped: true,
          reason: "stale_uninstall_after_reinstall",
          shop,
        };
      }

      const editHistoryIds = await prisma.editHistory.findMany({
        where: { shop },
        select: { id: true },
      });

      const historyIdList = editHistoryIds.map((record) => record.id);

      await clearShopSessions(shop).catch(() => {});

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
        await tx.collection.deleteMany({ where: { shop } });
        await tx.location.deleteMany({ where: { shop } });
        await tx.targetSnapshot.deleteMany({ where: { shop } });
        await tx.filterTrack.deleteMany({ where: { shop } });
        await tx.syncHistory.deleteMany({ where: { shop } });
        await tx.editHistory.deleteMany({ where: { shop } });
        await tx.exportHistory.deleteMany({ where: { shop } });
        await tx.exportJob.deleteMany({ where: { shop } });
        await tx.recurringEditRun.deleteMany({ where: { shop } });
        await tx.scheduledExportRun.deleteMany({ where: { shop } });
        await tx.automaticProductRuleRun.deleteMany({ where: { shop } });
        await tx.automaticProductRuleProductState.deleteMany({ where: { shop } });

        await tx.recurringEdit.updateMany({
          where: { shop },
          data: {
            status: "CANCELLED",
            isDeleted: true,
            nextRunAt: null,
            endAt: uninstallReceivedAt,
          },
        });

        await tx.scheduledExport.updateMany({
          where: { shop },
          data: {
            status: "CANCELLED",
            isDeleted: true,
            nextRunAt: null,
            endAt: uninstallReceivedAt,
          },
        });

        await tx.automaticProductRule.updateMany({
          where: { shop },
          data: {
            status: "CANCELLED",
            isDeleted: true,
            nextRunAt: null,
            endAt: uninstallReceivedAt,
          },
        });

        await tx.subscription.updateMany({
          where: { shop },
          data: {
            status: "FREE",
            planKey: "FREE",
            planName: "Free Plan",
            subscriptionId: null,
            pendingSubscriptionId: null,
            pendingPlanKey: null,
            pendingPlanName: null,
            trialEndsAt: null,
            currentPeriodEnd: null,
          },
        });

        await tx.store.update({
          where: { shopUrl: shop },
          data: {
            accessToken: null,
            scope: null,
            isUnInstalled: true,
            unInstalledAt:
              store.unInstalledAt && store.unInstalledAt > uninstallReceivedAt
                ? store.unInstalledAt
                : uninstallReceivedAt,
            activeMirrorBatchId: null,
            activeCollectionBatchId: null,
            isProductSyncing: false,
            isCollectionSyncing: false,
            isProductTypeSyncing: false,
            isProductInitialySyning: false,
            productInitialSyncProgress: 0,
            shopifyBulkJobCompleted: false,
            storeTotalProducts: 0,
            syncProgressStage: "IDLE",
          },
        });
      });

      await clearShopSessions(shop).catch(() => {});
      await clearAllCachesForShop(shop).catch(() => {});

      if (store.shopEmail && job.attemptsMade === 0) {
        await sendEmail(
          store.shopEmail,
          "Your feedback would mean the world to us",
          uninstallFeedbackHTML("Metamatrix User", shop, shop.split(".")[0]),
          true,
        ).catch((error) => {
          logger.warn("App uninstall feedback email failed", {
            worker: "appUninstallWorker",
            shop,
            message: error.message,
          });
        });
      }

      logger.info("App uninstall background job completed", {
        worker: "appUninstallWorker",
        jobId: job.id,
        shop,
        uninstallReceivedAt: uninstallReceivedAt.toISOString(),
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
