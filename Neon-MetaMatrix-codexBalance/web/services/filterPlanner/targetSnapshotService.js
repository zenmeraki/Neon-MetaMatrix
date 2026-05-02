import { prisma } from "../../config/database.js";
import { productTargetRepository } from "./productTargetRepository.js";

const SNAPSHOT_BATCH_SIZE = 1000;

export const targetSnapshotService = {
  async freeze({
    ownerType,
    ownerId,
    shop,
    mirrorBatchId,
    filterParams = [],
    db = prisma,
  }) {
    if (!ownerType || !ownerId) {
      throw new Error("ownerType and ownerId are required");
    }

    await db.targetSnapshot.deleteMany({
      where: { ownerType, ownerId, shop },
    });

    let cursorId = null;
    let totalInserted = 0;

    while (true) {
      const page = await productTargetRepository.streamIds({
        filterParams,
        shop,
        mirrorBatchId,
        cursorId,
        limit: SNAPSHOT_BATCH_SIZE,
      });

      if (!page.productIds.length) break;

      await db.targetSnapshot.createMany({
        data: page.productIds.map((productId, index) => ({
          ownerType,
          ownerId,
          shop,
          productId,
          ordinal: totalInserted + index + 1,
          mirrorBatchId,
        })),
      });

      totalInserted += page.productIds.length;
      cursorId = page.productIds[page.productIds.length - 1];

      if (page.productIds.length < SNAPSHOT_BATCH_SIZE) break;
    }

    return totalInserted;
  },
};
