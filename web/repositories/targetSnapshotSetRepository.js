import { prisma } from "../config/database.js";
import crypto from "crypto";
import { stableCanonicalStringify } from "../utils/stableCanonicalStringify.js";

function getClient(db) {
  return db || prisma;
}

function fingerprintBeforeValues({ productId, variantId = null, beforeValues = null }) {
  return crypto
    .createHash("sha256")
    .update(
      stableCanonicalStringify({
        productId,
        variantId,
        beforeValues,
      }),
    )
    .digest("hex");
}

export const targetSnapshotSetRepository = {
  async createMany(targets = [], db = prisma) {
    if (!targets.length) return { count: 0 };

    return getClient(db).targetSnapshotSet.createMany({
      data: targets,
      skipDuplicates: true,
    });
  },

  async listPage(operationId, { skip = 0, take = 100 } = {}, db = prisma) {
    return getClient(db).targetSnapshotSet.findMany({
      where: { operationId },
      orderBy: [{ ordinal: "asc" }, { id: "asc" }],
      skip,
      take,
    });
  },

  async countByOperation(operationId, shopOrDb = prisma, dbOverride = null) {
    let db = dbOverride || prisma;
    let shop = null;

    if (typeof shopOrDb === "string") {
      shop = shopOrDb;
    } else {
      db = shopOrDb || prisma;
    }

    return getClient(db).targetSnapshotSet.count({
      where: {
        operationId,
        ...(shop ? { shop } : {}),
      },
    });
  },

  async materializeFromEditHistory({ operationId, shop, historyId }, db = prisma) {
    const client = getClient(db);
    const pageSize = 1_000;
    const insertChunkSize = 250;
    let lastOrdinal = -1;
    let inserted = 0;

    await client.immutableTargetSnapshotSet.upsert({
      where: {
        shop_operationId: {
          shop,
          operationId,
        },
      },
      update: {},
      create: {
        shop,
        operationId,
        mirrorBatchId: "",
        filterAst: {},
        filterHash: "",
        targetHash: "",
        productCount: 0,
        variantCount: 0,
      },
    });

    const immutableSet = await client.immutableTargetSnapshotSet.findUnique({
      where: {
        shop_operationId: {
          shop,
          operationId,
        },
      },
      select: { id: true },
    });
    if (!immutableSet?.id) {
      throw new Error("IMMUTABLE_TARGET_SNAPSHOT_SET_REQUIRED");
    }

    while (true) {
      const page = await client.targetSnapshot.findMany({
        where: {
          ownerType: "EDIT_HISTORY",
          ownerId: historyId,
          shop,
          ordinal: { gt: lastOrdinal },
        },
        orderBy: { ordinal: "asc" },
        take: pageSize,
        select: {
          productId: true,
          variantId: true,
          ordinal: true,
          beforeValueJson: true,
        },
      });

      if (!page.length) break;

      const rows = page.map((target) => ({
        operationId,
        shop,
        entityId: target.productId,
        ordinal: target.ordinal,
      }));
      const immutableRows = page.map((target) => ({
        shop,
        snapshotSetId: immutableSet.id,
        productId: target.productId,
        variantId: target.variantId ?? null,
        beforeValues: target.beforeValueJson ?? null,
        afterValues: null,
        beforeFingerprint: fingerprintBeforeValues({
          productId: target.productId,
          variantId: target.variantId ?? null,
          beforeValues: target.beforeValueJson ?? null,
        }),
        beforeHash: null,
      }));
      const chunks = [];

      for (let index = 0; index < rows.length; index += insertChunkSize) {
        chunks.push(rows.slice(index, index + insertChunkSize));
      }

      const results = await client.$transaction(
        chunks.map((chunk) =>
          client.targetSnapshotSet.createMany({
            data: chunk,
            skipDuplicates: true,
          }),
        ),
      );
      const immutableResults = await client.$transaction(
        chunks.map((_, idx) => {
          const start = idx * insertChunkSize;
          const chunk = immutableRows.slice(start, start + insertChunkSize);
          return client.immutableTargetSnapshotItem.createMany({
            data: chunk,
            skipDuplicates: true,
          });
        }),
      );

      inserted += results.reduce((sum, result) => sum + result.count, 0);
      const immutableInserted = immutableResults.reduce(
        (sum, result) => sum + result.count,
        0,
      );
      if (immutableInserted < 0) {
        throw new Error("IMMUTABLE_TARGET_SNAPSHOT_INSERT_FAILED");
      }
      lastOrdinal = page[page.length - 1].ordinal;

      rows.length = 0;
      chunks.length = 0;
    }

    await client.immutableTargetSnapshotSet.update({
      where: {
        shop_operationId: {
          shop,
          operationId,
        },
      },
      data: {
        productCount: inserted,
      },
    });

    return { count: inserted };
  },

  async createManyInChunks(targets = [], { chunkSize = 250 } = {}, db = prisma) {
    if (!targets.length) return { count: 0 };

    const client = getClient(db);
    let inserted = 0;

    for (let index = 0; index < targets.length; index += chunkSize) {
      const chunk = targets.slice(index, index + chunkSize);
      const result = await client.targetSnapshotSet.createMany({
        data: chunk,
        skipDuplicates: true,
      });
      inserted += result.count;
    }

    return { count: inserted };
  },
};
