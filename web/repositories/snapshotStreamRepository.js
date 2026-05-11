import { prisma } from "../config/database.js";

function getClient(db) {
  return db || prisma;
}

function normalizeBatchSize(limit, fallback = 1000, max = 10000) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

export const snapshotStreamRepository = {
  async streamImmutableTargetsByOrdinal(
    {
      shop,
      snapshotSetId,
      afterOrdinal = 0,
      limit = 1000,
      select = undefined,
    },
    db = prisma,
  ) {
    const safeLimit = normalizeBatchSize(limit);
    return getClient(db).immutableTargetSnapshotItem.findMany({
      where: {
        shop,
        snapshotSetId,
        ordinal: { gt: Number(afterOrdinal || 0) },
      },
      orderBy: [{ ordinal: "asc" }],
      take: safeLimit,
      ...(select ? { select } : {}),
    });
  },

  async streamTargetsByOrdinal(
    {
      shop,
      snapshotSetId,
      afterOrdinal = 0,
      limit = 1000,
      select = undefined,
    },
    db = prisma,
  ) {
    const safeLimit = normalizeBatchSize(limit);
    return getClient(db).targetSnapshot.findMany({
      where: {
        shop,
        snapshotSetId,
        ordinal: { gt: Number(afterOrdinal || 0) },
      },
      orderBy: [{ ordinal: "asc" }],
      take: safeLimit,
      ...(select ? { select } : {}),
    });
  },
};
