// web/Jobs/Workers/appInstallationWorker.js (or your actual path)
import dayjs from "dayjs";
import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import { getShopOwnerEmailAddress } from "../../utils/sessionHandler.js";
import shopify from "../../shopify.js";
import {
  confirmShopInstallation,
  sentInstalledMailToAdmin,
  sentWelcomeMailToStore,
} from "../../middleware/appInstallMiddleware.js";

import { logWorkerError } from "../../utils/errorLogUtils.js";

// 🔹 Your email + affiliate utils (already referenced)
import { sendEmail } from "../../utils/emailHelper.js";
// 🔹 Prisma
import { prisma } from "../../config/database.js";


const appInstallationWorker = new Worker(
  process.env.APP_INSTALLATION_QUEUE,
  async (job) => {
    const { session, email, shopOwner } = job.data;
    const shop = session.shop;

    try {
      // 1️⃣ Welcome email
      await sentWelcomeMailToStore({ email, shop, shopOwner });

      // 2️⃣ Admin notification
      await sentInstalledMailToAdmin({ email, shop });

      // 3️⃣ Referral handling (slow, async)
      //    Mongo: Store.findOne({ shopUrl: shop })
      const store = await prisma.store.findUnique({
        where: { shopUrl: shop },
      });

      if (store?.referredBy) {
        // Mongo:
        // const referredUser = await AffiliateUser.findOneAndUpdate(
        //   { referralCode: store.referredBy },
        //   { $inc: { numberOfReferrals: 1 } },
        //   { new: true }
        // );

        let referredUser = null;
        try {
          referredUser = await prisma.affiliateUser.update({
            where: { referralCode: store.referredBy },
            data: {
              numberOfReferrals: {
                increment: 1,
              },
            },
          });
        } catch (e) {
          // If no affiliate user exists with that referralCode, skip email silently
          if (e.code === "P2025") {
            // record not found
            referredUser = null;
          } else {
            throw e;
          }
        }

        if (referredUser) {
          const subject =
            "🎉 A new store installed MetaMatrix using your referral!";

          const emailContent = getReferralEmailContent({
            referredUser,
            shop,
          });

          await sendEmail(referredUser.email, subject, emailContent, true);
        }
      }

      return { success: true };
    } catch (err) {
      // Log error via your centralized worker logger
      await logWorkerError({
        shop: session?.shop,
        err,
        source: "AppInstallationWorker",
      });

      throw err; // keep BullMQ retry behavior intact
    }
  },
  { connection, concurrency: 1 }
);

const logTime = () => `[${dayjs().format("YYYY-MM-DD HH:mm:ss")}]`;

// ✅ Dev logging only
if (process.env.NODE_ENV !== "production") {
  appInstallationWorker
    .on("error", (err) => {
      console.error(
        `${logTime()} ❌ Worker Error in App Installation Queue:`,
        err.message
      );
    })
    .on("waiting", (jobId) => {
      console.log(`${logTime()} ⏳ Job waiting | Job ID: ${jobId}`);
    })
    .on("active", (job) => {
      console.log(`${logTime()} 🚀 Job started | Job ID: ${job.id}`);
    })
    .on("completed", (job, result) => {
      console.log(
        `${logTime()} ✅ Job completed | Job ID: ${job.id} | Result:`,
        result
      );
    })
    .on("failed", async (job, err) => {
      console.error(
        `${logTime()} ❗ Job failed | Job ID: ${job.id} | Error:`,
        err.message
      );

      // Optional: Log failed job to DB even in dev
      await logWorkerError({
        shop: job.data?.session?.shop,
        err,
        source: "AppInstallationWorker-FailedEvent",
      });
    });
}

export default appInstallationWorker;