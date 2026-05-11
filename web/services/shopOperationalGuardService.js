import { prisma } from "../config/database.js";

export async function assertShopOperational(shop) {
  if (!shop || typeof shop !== "string") {
    const error = new Error("SHOP_REQUIRED");
    error.code = "SHOP_REQUIRED";
    throw error;
  }

  const store = await prisma.store.findUnique({
    where: { shopUrl: shop },
    select: {
      shopUrl: true,
      isUnInstalled: true,
      accessToken: true,
    },
  });

  if (!store || store.isUnInstalled || !store.accessToken) {
    const error = new Error("SHOP_UNINSTALLED");
    error.code = "SHOP_UNINSTALLED";
    throw error;
  }

  return store;
}

