// web/utils/sessionHandler.js
import shopify from "../shopify.js";

import { prisma } from "../config/database.js";


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
    const store = await prisma.store.findUnique({
      where: { shopUrl: shop },
      select: {
        shopUrl: true,
        accessToken: true,
      },
    });

    if (!store || !store.accessToken) {
      throw new Error(`No active session found for shop: ${shop}`);
    }

    // Shape compatible with how you use `session` elsewhere
    return {
      shop: store.shopUrl,
      accessToken: store.accessToken,
    };
  } catch (error) {
    // Optional: log error for debugging
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