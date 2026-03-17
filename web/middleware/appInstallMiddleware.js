import { th } from "zod/v4/locales";
import { addAppInstallationJob } from "../Jobs/Queues/appInstallationJob.js";
import { getReferralEmailContent } from "../Config/templates/referralTemplate.js";
import {
  adminInstallNotificationHTML,
  welcomeEmailHTML,
} from "../Config/templates/welcomeTemplate.js";
import { sendEmail } from "../utils/emailHelper.js";
import { generateReferralCode } from "../utils/referralUtils.js";
import { getShopOwnerEmailAddress } from "../utils/sessionHandler.js";
import { clearKeyCaches } from "../utils/cacheUtils.js";
import shopify from "../shopify.js";
import { Services } from "../services/productService/productFilterService.js";
import { logApiError } from "../utils/errorLogUtils.js";

import { prisma } from "../config/database.js";

export const sentWelcomeMailToStore = async ({ email, shopOwner, shop }) => {
  try {
    const subject = "🎉 Welcome to Metamatrix!";
    const formatedShop = shop.split(".")[0];
    const htmlMessage = welcomeEmailHTML(shopOwner, formatedShop);

    await sendEmail(email, subject, htmlMessage, true);
  } catch (error) {
    throw error;
  }
};

export const sentInstalledMailToAdmin = async ({ email, shop }) => {
  try {
    const subject = "🎉 New Metamatrix Installation";
    const formatedShop = shop.split(".")[0];
    const adminEmail = "zenmerakihelp@gmail.com";
    const htmlMessage = adminInstallNotificationHTML(
      shop,
      email,
      formatedShop,
      new Date().toDateString()
    );

    await sendEmail(adminEmail, subject, htmlMessage, true);
  } catch (error) {
    throw error;
  }
};

export const confirmShopInstallation = async ({
  session,
  email,
  shop,
  accessToken,
}) => {
try {
    // 🔍 Check if store exists
    const existingStore = await prisma.store.findUnique({
      where: { shopUrl: shop },
    });

    if (!existingStore) {
      // 🔍 Most recent referral code for this shop
      const latestReferral = await prisma.referralCode.findFirst({
        where: { shop },
        orderBy: { createdAt: "desc" },
      });

      const newReferralCode = generateReferralCode(shop);

      // 🆕 Create store
      const newStore = await prisma.store.create({
        data: {
          shopUrl: shop,
          accessToken,
          shopEmail: email,
          isUnInstalled: false,
          unInstalledAt: null,
          scope: session.scope,
          installedAt: new Date(),
          referralCode: newReferralCode,
          referralLink: `https://zenmeraki.com/metamatrix-app?ref=${newReferralCode}`,
          referredBy: latestReferral ? latestReferral.referralCode : null,

          // Map referralReward.rewardExpiresAt → flattened refRewardExpiresAt
          refRewardExpiresAt: latestReferral
            ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            : null,
          // Other ref* fields can stay defaulted
        },
      });

      // If referred, increment affiliate's numberOfReferrals and send email
      if (newStore.referredBy) {
        const referredUser = await prisma.affiliateUser.update({
          where: { referralCode: newStore.referredBy },
          data: {
            numberOfReferrals: { increment: 1 },
          },
        });

        const subject =
          "🎉 Great News! A New Store Installed MetaMatrix Using Your Referral";
        const emailContent = getReferralEmailContent({ referredUser, shop });

        await sendEmail(referredUser.email, subject, emailContent, true);
      }

      // 🧹 Clean up referral codes for the shop
      await prisma.referralCode.deleteMany({
        where: { shop },
      });
    } else {
      // 🔄 Update existing store
      await prisma.store.update({
        where: { shopUrl: shop },
        data: {
          accessToken,
          shopEmail: email,
          isUnInstalled: false,
          unInstalledAt: null,
          installedAt: new Date(),
        },
      });
    }

    // 🧹 Clear all relevant cache keys for the shop
    await clearKeyCaches(`${shop}:storeDetails`);
    await clearKeyCaches(`${shop}:sync_details`);
  } catch (error) {
    throw error;
  }
};

export const shopPreInstallation = async (req, res, next) => {
  const { shop, ref } = req.query;
    try {
    if (!shop || !ref) {
      return next();
    }

    const affiliateUserExist = await prisma.affiliateUser.findUnique({
      where: { referralCode: ref },
    });

    if (affiliateUserExist) {
      await prisma.referralCode.create({
        data: {
          shop,
          referralCode: ref,
        },
      });
    }

    next();
  } catch (error) {
    throw error;
  }
};

export const appInstallMiddleware = async (req, res, next) => {
  const session = res.locals.shopify?.session;

  try {
    if (!session) {
      return res.status(401).send("Shopify session missing");
    }

    const { shop, accessToken } = session;

    // 1️⃣ Get shop email + owner
    const { email, shopOwner } = await getShopOwnerEmailAddress(session);

    // 2️⃣ Save / update store (CRITICAL)
    await confirmShopInstallation({
      session,
      shop,
      email,
      accessToken,
    });

    // 3️⃣ Fetch product count (CRITICAL)
    const client = new shopify.api.clients.Graphql({ session });
    const response = await client.request(`
      query {
        productsCount {
          count
        }
      }
    `);

    const count = response?.data?.productsCount?.count || 0;

    // 4️⃣ Start bulk product sync (CRITICAL)
    const service = new Services();
    await service.startBulkOperationToFetchProducts({
      session,
      isInitialSync: true,
    });

    // 5️⃣ Update sync flags
    await prisma.store.update({
      where: { shopUrl: shop },
      data: {
        storeTotalProducts: count,
        isProductInitialySyning: true,
        shopifyBulkJobCompleted: false,
      },
    });

    // 6️⃣ Push NON-CRITICAL stuff to worker
    await addAppInstallationJob({
      session,
      email,
      shopOwner,
    });

    next(); // 🚀 load app fast
  } catch (err) {
    // Log the error to Mongo
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "appInstallMiddleware",
    });

    console.error("App install error:", err);
    res.status(500).send("Installation failed");
  }
};
