// web/utils/sessionHandler.js
import { Prisma } from "../generated/prisma/index.js";
import shopify from "../shopify.js";
import { prisma } from "../config/database.js";
import logger from "./loggerUtils.js";

export async function getStoreLifecycleState(shop) {
  if (!shop) {
    return null;
  }

  return prisma.store.findUnique({
    where: { shopUrl: shop },
    select: {
      shopUrl: true,
      accessToken: true,
      scope: true,
      isUnInstalled: true,
      installedAt: true,
      unInstalledAt: true,
    },
  });
}

export async function assertShopIsActive(shop) {
  const store = await getStoreLifecycleState(shop);

  if (!store || store.isUnInstalled || !store.accessToken) {
    throw new Error(`Shop is not active: ${shop}`);
  }

  return store;
}

export async function clearShopSessions(shop) {
  if (!shop) {
    return 0;
  }

  try {
    const result = await prisma.shopifySession.deleteMany({
      where: { shop },
    });

    return Number(result?.count || 0);
  } catch (error) {
    logger.error("Failed to clear Shopify sessions for shop", {
      shop,
      message: error?.message || String(error),
    });
    throw error;
  }
}

export const getSession = async (shop) => {
  try {
    const store = await assertShopIsActive(shop);
    const sessionId = `offline_${shop}`;
    const storedSession = await shopify.config.sessionStorage
      .loadSession(sessionId)
      .catch(() => null);

    if (storedSession?.accessToken) {
      return storedSession;
    }

    return {
      shop: store.shopUrl,
      accessToken: store.accessToken,
      scope: store.scope || undefined,
    };
  } catch (error) {
    logger.warn("Failed to retrieve active shop session", {
      shop,
      message: error?.message || String(error),
    });
    throw new Error("Failed to retrieve session");
  }
};

export const getShopOwnerEmailAddress = async (session) => {
  try {
    const client = new shopify.api.clients.Graphql({ session });

    const response = await client.query({
      data: {
        query: `
          {
            shop {
              email
              shopOwnerName
            }
          }
        `,
      },
    });

    const shopData = response.body.data.shop;
    return {
      email: shopData.email,
      shopOwner: shopData.shopOwnerName,
    };
  } catch (error) {
    throw new Error(
      error.message || "Failed to retrieve shop owner email address",
    );
  }
};
