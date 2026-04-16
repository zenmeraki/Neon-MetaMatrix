// web/controllers/storeController.js (or wherever this lives)

import { getCache, setCache } from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";

import { prisma } from "../Config/database.js";

export const getStoreAccess = async (req, res) => {
  const session = res.locals.shopify.session;

  try {
    if (!session?.shop) {
      return res.status(401).json({
        message: "Shopify session missing",
      });
    }

    const cacheKey = `${session.shop}:storeDetails`;

    // 1️⃣ Try cache first
    const cacheData = await getCache(cacheKey);
    if (cacheData) {
      return res.status(200).json(cacheData);
    }

    // 2️⃣ Fetch store from Prisma
    const store = await prisma.store.findUnique({
      where: { shopUrl: session.shop },
      select: {
        shopUrl: true,
        referralLink: true,         // you were selecting this in Mongo, even if not using it in response
        isCreditAvailable: true,
        isProductInitialySyning: true, // flattened version of syncDetails.isProductInitialySyning
      },
    });

    if (!store) {
      return res.status(404).json({
        message: "Store not found",
      });
    }

    // 3️⃣ Count completed edit histories (status IN ["completed", "Undo completed"])
    const historiesCount = await prisma.editHistory.count({
      where: {
        shop: session.shop,
        status: {
          in: ["completed", "Undo completed"],
        },
      },
    });

    // 4️⃣ Count completed sync histories
    const syncCount = await prisma.syncHistory.count({
      where: {
        shop: session.shop,
        status: "completed",
      },
    });

    // 5️⃣ Assemble response (shape kept same as original)
    const responseData = {
      message: "fetched store access successfully",
      shopUrl: store.shopUrl,
      totalbulkEditCount: historiesCount,
      totalSyncCount: syncCount,
      isInitialProductSyncRunning: store.isProductInitialySyning,
      isProductInitialySyning: store.isProductInitialySyning,
      isCreditAvailable: store.isCreditAvailable || false,
    };

    // 6️⃣ Cache for 5 min
    await setCache(cacheKey, responseData, 300);

    return res.status(200).json(responseData);
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "storeController.getStoreAccess",
    });

    return res.status(500).json({
      message: "Error fetching store access",
      error: error.message,
    });
  }
};
