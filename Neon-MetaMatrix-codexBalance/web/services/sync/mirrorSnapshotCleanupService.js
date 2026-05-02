import { prisma } from "../../config/database.js";

const CLEANUP_BATCH_SIZE = Number(
  process.env.MIRROR_SNAPSHOT_CLEANUP_BATCH_SIZE || 5000,
);

async function deleteVariantBatch({ shop, mirrorBatchId, batchSize }) {
  const rows = await prisma.variant.findMany({
    where: { shop, mirrorBatchId },
    select: { id: true },
    orderBy: { id: "asc" },
    take: batchSize,
  });

  if (!rows.length) return 0;

  const deleted = await prisma.variant.deleteMany({
    where: {
      shop,
      mirrorBatchId,
      id: { in: rows.map((row) => row.id) },
    },
  });

  return deleted.count;
}

async function deleteProductBatch({ shop, mirrorBatchId, batchSize }) {
  const rows = await prisma.product.findMany({
    where: { shop, mirrorBatchId },
    select: { id: true },
    orderBy: { id: "asc" },
    take: batchSize,
  });

  if (!rows.length) return 0;

  const deleted = await prisma.product.deleteMany({
    where: {
      shop,
      mirrorBatchId,
      id: { in: rows.map((row) => row.id) },
    },
  });

  return deleted.count;
}

export const mirrorSnapshotCleanupService = {
  async cleanupMirrorBatch({ shop, mirrorBatchId, replacedByBatchId = null }) {
    if (!shop || !mirrorBatchId) {
      throw new Error("shop and mirrorBatchId are required");
    }

    const store = await prisma.store.findUnique({
      where: { shopUrl: shop },
      select: { activeMirrorBatchId: true },
    });

    if (store?.activeMirrorBatchId === mirrorBatchId) {
      return {
        skipped: true,
        reason: "batch_is_still_active",
        shop,
        mirrorBatchId,
      };
    }

    let deletedVariants = 0;
    let deletedProducts = 0;

    while (true) {
      const count = await deleteVariantBatch({
        shop,
        mirrorBatchId,
        batchSize: CLEANUP_BATCH_SIZE,
      });
      deletedVariants += count;
      if (count < CLEANUP_BATCH_SIZE) break;
    }

    while (true) {
      const count = await deleteProductBatch({
        shop,
        mirrorBatchId,
        batchSize: CLEANUP_BATCH_SIZE,
      });
      deletedProducts += count;
      if (count < CLEANUP_BATCH_SIZE) break;
    }

    return {
      success: true,
      shop,
      mirrorBatchId,
      replacedByBatchId,
      deletedVariants,
      deletedProducts,
    };
  },
};
