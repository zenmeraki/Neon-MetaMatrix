import { prisma } from "../../Config/database.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";

export async function markProductSyncStarted({ shop }) {
  await prisma.store.update({
    where: { shopUrl: shop },
    data: {
      isProductSyncing: true,
      lastProductSyncAt: new Date(),
    },
  });
}

export async function createProductSyncHistory({
  shop,
  bulkOperationId,
  isInitialSync = false,
}) {
  await prisma.syncHistory.create({
    data: {
      shop,
      bulkOperationId,
      status: "processing",
      operationType: "Product",
      isInitialProductSync: isInitialSync,
    },
  });
}

export async function clearProductSyncCache(shop) {
  await clearKeyCaches(`${shop}:sync_details`);
}

export async function replaceShopProducts(shop) {
  await prisma.variant.deleteMany({ where: { shop } });
  await prisma.product.deleteMany({ where: { shop } });
}

export async function insertProductMirrorBatch({ productRows, variantRows }) {
  await prisma.$transaction([
    prisma.product.createMany({
      data: productRows,
      skipDuplicates: true,
    }),
    prisma.variant.createMany({
      data: variantRows,
      skipDuplicates: true,
    }),
  ]);
}

export async function updateInitialSyncProgress({ shop, totalProductsProcessed }) {
  await prisma.store.update({
    where: { shopUrl: shop },
    data: {
      productInitialSyncProgress: totalProductsProcessed,
    },
  });
}
