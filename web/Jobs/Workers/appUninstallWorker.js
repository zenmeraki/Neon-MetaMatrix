import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import { sendEmail } from "../../utils/emailHelper.js";
import { uninstallFeedbackHTML } from "../../Config/templates/uninstallTemplate.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { logWebhookError } from "../../utils/errorLogUtils.js";

import { prisma } from "../../Config/database.js";


const appUninstallWorker = new Worker(
  "appUninstall",
  async (job) => {
    const { shop, body, webhookId, topic } = job.data;

    try {
      // Find store details
 const store = await prisma.store.findUnique({
        where: { shopUrl: shop },
        select: { shopEmail: true },
      });  
      if (!store) {
        return {
          success: false,
          message: "Store not found",
          shop,
        };
      }

      // 1️⃣ Delete related edit history change records
      const editHistories = await prisma.editHistory.findMany({
        where: { shop },
        select: { id: true },
      });

      // 2️⃣ Delete all related collections for the shop
     const deletionResults = await Promise.allSettled([
        prisma.changeRecord.deleteMany({
          where: { editHistoryId: { in: editHistoryIds } },
        }),
        prisma.product.deleteMany({ where: { shop } }),
        prisma.exportHistory.deleteMany({ where: { shop } }),
        prisma.collection.deleteMany({ where: { shop } }),
        // 🔸 Requires a Prisma model `FilterCombination` with at least `shop: String`
        prisma.filterCombination.deleteMany({ where: { shop } }),
      ]);

      const collectionNames = [
        "ChangeRecords",
        "Products",
        "ExportHistory",
        "Collections",
        "FilterCombinations",
      ];

      deletionResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          console.log(
            `✅ Deleted ${result.value.deletedCount} ${collectionNames[index]} for shop: ${shop}`
          );
        } else {
          console.error(
            `❌ Failed to delete ${collectionNames[index]}:`,
            result.reason
          );
        }
      });

      // 3️⃣ Send feedback email
      const subject = "Your feedback would mean the world to us";
      const formattedShop = shop.split(".")[0];
      const htmlMessage = uninstallFeedbackHTML(
        "Metamatrix User",
        shop,
        formattedShop
      );
      await sendEmail(store.shopEmail, subject, htmlMessage, true);

      // 4️⃣ Update store as uninstalled
       const updatedStore = await prisma.store.update({
        where: { shopUrl: shop },
        data: {
          isUnInstalled: true,
          unInstalledAt: new Date(),
        },
      });

      // 5️⃣ Clear caches
      await clearKeyCaches(`${shop}`);

      return {
        success: true,
        message: "App uninstall processed successfully",
        shop,
        emailSent: true,
        storeUpdated: !!updatedStore,
      };
    } catch (error) {
      // 🔹 Log the error persistently in Mongo
      await logWebhookError({
        shop,
        err: error,
        source: "appUninstallWorker",
        req: job.data, // You can log job data as context
      });

      throw error; // Retain BullMQ retry behavior
    }
  },
  { connection, concurrency: 1 }
);

// Event listeners for dev
appUninstallWorker.on("completed", (job, result) => {
  console.log(`✅ App uninstall job completed: ${job.id}`, result);
});

appUninstallWorker.on("failed", (job, error) => {
  console.error(`❌ App uninstall job failed: ${job.id}`, {
    shop: job.data.shop,
    error: error.message,
    attemptsMade: job.attemptsMade,
  });
});

appUninstallWorker.on("error", (error) => {
  console.error("❌ App uninstall worker error:", error);
});

export default appUninstallWorker;
