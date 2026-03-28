import { addAppInstallationJob } from "../Jobs/Queues/appInstallationJob.js";
import { getReferralEmailContent } from "../Config/templates/referralTemplate.js";
import {
  adminInstallNotificationHTML,
  welcomeEmailHTML,
} from "../Config/templates/welcomeTemplate.js";
import { sendEmail } from "../utils/emailHelper.js";
import { generateReferralCode } from "../utils/referralUtils.js";
import { clearKeyCaches } from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { prisma } from "../config/database.js";

/* ------------------------------------------------------------------ */
/*  Email helpers (called from worker)                                 */
/* ------------------------------------------------------------------ */

export const sentWelcomeMailToStore = async ({ email, shopOwner, shop }) => {
  const subject = "🎉 Welcome to Metamatrix!";
  const formatedShop = shop.split(".")[0];
  const htmlMessage = welcomeEmailHTML(shopOwner, formatedShop);
  await sendEmail(email, subject, htmlMessage, true);
};

export const sentInstalledMailToAdmin = async ({ email, shop }) => {
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
};

/* ------------------------------------------------------------------ */
/*  Full store setup (called from worker, after middleware upsert)     */
/* ------------------------------------------------------------------ */

export const confirmShopInstallation = async ({
  session,
  email,
  shop,
  accessToken,
}) => {
  // The store row already exists (created by middleware upsert).
  // Check if this is a new install by whether referralCode has been set yet.
  const existingStore = await prisma.store.findUnique({
    where: { shopUrl: shop },
    select: { referralCode: true, referredBy: true },
  });

  const isNewInstall = !existingStore?.referralCode;

  if (isNewInstall) {
    // Lookup any referral code that was saved during shopPreInstallation
    const latestReferral = await prisma.referralCode.findFirst({
      where: { shop },
      orderBy: { createdAt: "desc" },
    });

    const newReferralCode = generateReferralCode(shop);

    // Patch the store row with full referral + email data
    const updatedStore = await prisma.store.update({
      where: { shopUrl: shop },
      data: {
        shopEmail: email,
        accessToken,
        scope: session.scope,
        referralCode: newReferralCode,
        referralLink: `https://zenmeraki.com/metamatrix-app?ref=${newReferralCode}`,
        referredBy: latestReferral?.referralCode ?? null,
        refRewardExpiresAt: latestReferral
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          : null,
      },
    });

    // Notify affiliate if referred
    if (updatedStore.referredBy) {
      let referredUser = null;
      try {
        referredUser = await prisma.affiliateUser.update({
          where: { referralCode: updatedStore.referredBy },
          data: { numberOfReferrals: { increment: 1 } },
        });
      } catch (e) {
        if (e.code !== "P2025") throw e; // ignore "not found", rethrow anything else
      }

      if (referredUser) {
        const subject =
          "🎉 Great News! A New Store Installed MetaMatrix Using Your Referral";
        const emailContent = getReferralEmailContent({ referredUser, shop });
        await sendEmail(referredUser.email, subject, emailContent, true);
      }
    }

    // Clean up the temporary referral code row
    await prisma.referralCode.deleteMany({ where: { shop } });
  } else {
    // Reinstall — just refresh credentials + email
    await prisma.store.update({
      where: { shopUrl: shop },
      data: {
        accessToken,
        shopEmail: email,
        scope: session.scope,
        isUnInstalled: false,
        unInstalledAt: null,
        installedAt: new Date(),
      },
    });
  }

  await clearKeyCaches(`${shop}:storeDetails`);
  await clearKeyCaches(`${shop}:sync_details`);
};

/* ------------------------------------------------------------------ */
/*  Pre-install: capture referral code before OAuth begins             */
/* ------------------------------------------------------------------ */

export const shopPreInstallation = async (req, res, next) => {
  const { shop, ref } = req.query;
  try {
    if (!shop || !ref) return next();

    const affiliateUserExist = await prisma.affiliateUser.findUnique({
      where: { referralCode: ref },
    });

    if (affiliateUserExist) {
      await prisma.referralCode.create({
        data: { shop, referralCode: ref },
      });
    }

    next();
  } catch (error) {
    throw error;
  }
};

/* ------------------------------------------------------------------ */
/*  OAuth callback middleware — MUST return in < ~5s                   */
/* ------------------------------------------------------------------ */

export const appInstallMiddleware = async (req, res, next) => {
  const session = res.locals.shopify?.session;

  try {
    if (!session) {
      return res.status(401).send("Shopify session missing");
    }

    const { shop, accessToken } = session;

    // ✅ Bare-minimum DB write so the app has a valid store row
    //    before the browser lands on the dashboard.
    await prisma.store.upsert({
      where: { shopUrl: shop },
      create: {
        shopUrl: shop,
        accessToken,
        shopEmail: "",
        isUnInstalled: false,
        unInstalledAt: null,
        scope: session.scope,
        installedAt: new Date(),
      },
      update: {
        accessToken,
        isUnInstalled: false,
        unInstalledAt: null,
        installedAt: new Date(),
      },
    });

    // Redirect immediately. Background setup should never block OAuth callback.
    next();

    setImmediate(async () => {
      try {
        await clearKeyCaches(`${shop}:storeDetails`);
        await clearKeyCaches(`${shop}:sync_details`);

        await addAppInstallationJob({
          session: { shop, accessToken, scope: session.scope },
        });
      } catch (backgroundError) {
        await logApiError({
          shop,
          err: backgroundError,
          req,
          source: "appInstallMiddleware.backgroundSetup",
        }).catch(() => {});

        console.error("App install background setup error:", backgroundError);
      }
    });
  } catch (err) {
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
