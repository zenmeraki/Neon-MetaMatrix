import { prisma } from "../config/database.js";

function getClient(db) {
  return db || prisma;
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

  async countByOperation(operationId, db = prisma) {
    return getClient(db).targetSnapshotSet.count({
      where: { operationId },
    });
  },

  async materializeFromEditHistory({ operationId, shop, historyId }, db = prisma) {
    const client = getClient(db);
    const pageSize = 1_000;
    const insertChunkSize = 250;
    let lastOrdinal = -1;
    let inserted = 0;

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
          ordinal: true,
        },
      });

      if (!page.length) break;

      const rows = page.map((target) => ({
        operationId,
        shop,
        entityId: target.productId,
        ordinal: target.ordinal,
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

      inserted += results.reduce((sum, result) => sum + result.count, 0);
      lastOrdinal = page[page.length - 1].ordinal;

      rows.length = 0;
      chunks.length = 0;
    }

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
