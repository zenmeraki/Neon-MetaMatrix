import dayjs from "dayjs";
import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import { getShopOwnerEmailAddress } from "../../utils/sessionHandler.js";
import shopify from "../../shopify.js";
import { Services } from "../../services/productService/productFilterService.js";
import {
  confirmShopInstallation,
  sentInstalledMailToAdmin,
  sentWelcomeMailToStore,
} from "../../middleware/appInstallMiddleware.js";
import { logWorkerError } from "../../utils/errorLogUtils.js";
import { prisma } from "../../Config/database.js";

const appInstallationWorker = new Worker(
  process.env.APP_INSTALLATION_QUEUE,
  async (job) => {
    // Middleware only passes { shop, accessToken, scope } — no email yet
    const { session } = job.data;
    const { shop, accessToken } = session;

    // 1️⃣ Fetch shop owner details from Shopify (was blocking the redirect before)
    const { email, shopOwner } = await getShopOwnerEmailAddress(session);

    // 2️⃣ Full store setup: referral codes, affiliate tracking, email fields
    await confirmShopInstallation({ session, email, shop, accessToken });

    // 3️⃣ Fetch product count
    const client = new shopify.api.clients.Graphql({ session });
    const countResponse = await client.request(`
      query {
        productsCount {
          count
        }
      }
    `);
    const count = countResponse?.data?.productsCount?.count || 0;

    const [store, mirroredProductCount, latestCompletedSync] = await Promise.all([
      prisma.store.findUnique({
        where: { shopUrl: shop },
        select: {
          isProductSyncing: true,
          isProductInitialySyning: true,
          shopifyBulkJobCompleted: true,
        },
      }),
      prisma.product.count({
        where: { shop },
      }),
      prisma.syncHistory.findFirst({
        where: {
          shop,
          operationType: "Product",
          status: "completed",
        },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      }),
    ]);

    const shouldStartInitialSync =
      !store ||
      mirroredProductCount === 0 ||
      !latestCompletedSync ||
      store.shopifyBulkJobCompleted !== true;

    // 4️⃣ Only auto-sync on first install / empty mirror / incomplete bootstrap
    if (shouldStartInitialSync) {
      const service = new Services();
      await service.startBulkOperationToFetchProducts({
        session,
        isInitialSync: true,
      });

      await prisma.store.update({
        where: { shopUrl: shop },
        data: {
          storeTotalProducts: count,
          isProductInitialySyning: true,
          shopifyBulkJobCompleted: false,
        },
      });
    } else {
      await prisma.store.update({
        where: { shopUrl: shop },
        data: {
          storeTotalProducts: count,
          isProductInitialySyning: false,
        },
      });
    }

    // 5️⃣ Send emails last — non-critical, fine to be slow
    await sentWelcomeMailToStore({ email, shopOwner, shop });
    await sentInstalledMailToAdmin({ email, shop });

    return { success: true, startedInitialSync: shouldStartInitialSync };
  },
  {
    connection,
    concurrency: 5,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    },
  }
);

/* ------------------------------------------------------------------ */
/*  Logging                                                            */
/* ------------------------------------------------------------------ */

const logTime = () => `[${dayjs().format("YYYY-MM-DD HH:mm:ss")}]`;

appInstallationWorker.on("failed", async (job, err) => {
  console.error(
    `${logTime()} ❗ Job failed | Job ID: ${job?.id} | Error:`, err.message
  );
  await logWorkerError({
    shop: job?.data?.session?.shop,
    err,
    source: "AppInstallationWorker",
  });
});

if (process.env.NODE_ENV !== "production") {
  appInstallationWorker
    .on("error", (err) =>
      console.error(`${logTime()} ❌ Worker error:`, err.message)
    )
    .on("waiting", (jobId) =>
      console.log(`${logTime()} ⏳ Job waiting | Job ID: ${jobId}`)
    )
    .on("active", (job) =>
      console.log(`${logTime()} 🚀 Job started | Job ID: ${job.id}`)
    )
    .on("completed", (job, result) =>
      console.log(`${logTime()} ✅ Job completed | Job ID: ${job.id}`, result)
    );
}

export default appInstallationWorker;
