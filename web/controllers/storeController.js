import { getCache, setCache } from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { prisma } from "../config/database.js";

export const getStoreAccess = async (req, res) => {
  const session = res.locals.shopify.session;

  try {
    if (!session?.shop) {
      return res.status(401).json({
        message: "Shopify session missing",
      });
    }

    const cacheKey = `${session.shop}:storeDetails`;
    const cacheData = await getCache(cacheKey);
    if (cacheData) {
      return res.status(200).json(cacheData);
    }

    const store = await prisma.store.findUnique({
      where: { shopUrl: session.shop },
      select: {
        shopUrl: true,
        activeMirrorBatchId: true,
        referralLink: true,
        isCreditAvailable: true,
        isProductInitialySyning: true,
        lastProductSyncAt: true,
        mirrorHealthState: true,
        repairRequired: true,
        staleReason: true,
        storeTotalProducts: true,
      },
    });

    if (!store) {
      return res.status(404).json({
        message: "Store not found",
      });
    }

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [
      historiesCount,
      monthlyHistoriesCount,
      syncCount,
      exportCount,
      importCount,
      variantCount,
      subscription,
      latestOperation,
    ] = await Promise.all([
      prisma.editHistory.count({
        where: {
          shop: session.shop,
          status: {
            in: ["completed", "Undo completed"],
          },
        },
      }),
      prisma.editHistory.count({
        where: {
          shop: session.shop,
          createdAt: {
            gte: monthStart,
          },
          status: {
            in: ["completed", "Undo completed"],
          },
        },
      }),
      prisma.syncHistory.count({
        where: {
          shop: session.shop,
          status: "completed",
        },
      }),
      prisma.exportHistory.count({
        where: {
          shop: session.shop,
          status: {
            in: ["completed", "SUCCESS", "success", "ready", "READY"],
          },
        },
      }),
      prisma.editHistory.count({
        where: {
          shop: session.shop,
          isSpreadsheetEdit: true,
        },
      }),
      prisma.variant.count({
        where: {
          shop: session.shop,
          ...(store.activeMirrorBatchId
            ? { mirrorBatchId: store.activeMirrorBatchId }
            : {}),
        },
      }),
      prisma.subscription.findUnique({
        where: {
          shop: session.shop,
        },
        select: {
          planKey: true,
          planName: true,
          status: true,
        },
      }),
      prisma.merchantOperation.findFirst({
        where: {
          shop: session.shop,
        },
        orderBy: {
          createdAt: "desc",
        },
        select: {
          status: true,
          targetHash: true,
          createdAt: true,
          immutableSnapshots: {
            select: {
              mirrorBatchId: true,
            },
            take: 1,
            orderBy: {
              createdAt: "desc",
            },
          },
        },
      }),
    ]);

    const normalizedPlanKey = String(
      subscription?.planKey || "FREE"
    ).toUpperCase();
    const isPaidPlan =
      subscription?.status === "ACTIVE" && normalizedPlanKey !== "FREE";
    const maxEdits = isPaidPlan ? null : 100;

    const responseData = {
      message: "fetched store access successfully",
      shopUrl: store.shopUrl,
      mirrorHealthState: store.mirrorHealthState,
      repairRequired: store.repairRequired,
      staleReason: store.staleReason,
      storeTotalProducts: store.storeTotalProducts,
      storeTotalVariants: variantCount,
      lastProductSyncAt: store.lastProductSyncAt,
      totalBulkEditCount: historiesCount,
      totalbulkEditCount: historiesCount,
      totalExportCount: exportCount,
      totalImportCount: importCount,
      currentEditCount: monthlyHistoriesCount,
      maxEdits,
      planKey: subscription?.planKey || "FREE",
      planName: subscription?.planName || "Free Plan",
      planStatus: subscription?.status || "FREE",
      totalSyncCount: syncCount,
      isProductInitiallySyncing: store.isProductInitialySyning,
      isProductInitialySyning: store.isProductInitialySyning,
      isCreditAvailable: store.isCreditAvailable || false,
      trustState: {
        mirrorBatchId:
          store.activeMirrorBatchId ||
          latestOperation?.immutableSnapshots?.[0]?.mirrorBatchId ||
          null,
        variantBatchStatus: "unknown",
        collectionBatchStatus: "unknown",
        metafieldBatchStatus: "unknown",
        batchObservedAt: latestOperation?.createdAt || null,
      },
    };

    await setCache(cacheKey, responseData, 60);

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
