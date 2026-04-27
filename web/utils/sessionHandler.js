// web/utils/sessionHandler.js
import shopify from "../shopify.js";


// Legacy reference (kept as a comment for context)
// export const getSession = async (shop) => {
//   try {
//     const sessions = await shopify.config.sessionStorage.findSessionsByShop(shop);
//     if (!sessions || sessions.length === 0) {
//       throw new Error(`No active session found for shop: ${shop}`);
//     }
//     return sessions[0];
//   } catch (error) {
//     throw new Error("Failed to retrieve session");
//   }
// };

export const getSession = async (shop) => {
  try {
    const loadSession = shopify?.config?.sessionStorage?.loadSession;
    const getOfflineId = shopify?.api?.session?.getOfflineId;

    if (typeof loadSession !== "function" || typeof getOfflineId !== "function") {
      throw new Error("Shopify offline session storage is not configured");
    }

    const offlineSessionId = getOfflineId(shop);
    const session = await loadSession.call(
      shopify.config.sessionStorage,
      offlineSessionId,
    );

    if (!session?.accessToken || session.shop !== shop) {
      throw new Error(`No active session found for shop: ${shop}`);
    }

    return session;
  } catch (error) {
    console.error("[getSession] Failed to retrieve session for shop:", shop, error);
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
      error.message || "Failed to retrieve shop owner email address"
    );
  }
};
