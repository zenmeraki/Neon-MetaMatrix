import { prisma } from "../../config/database.js";

function getClient(db) {
  return db || prisma;
}

export const bulkEditIntentRepository = {
  async createCanonicalIntent({
    shop,
    operationId,
    mirrorBatchId,
    filterAst,
    actionAst,
    stableSort,
    canonicalIntentJson,
    canonicalFilterHash,
    canonicalActionHash,
    intentHash,
    plannerVersion,
    compilerVersion,
    intentVersion = 1,
  }, db = prisma) {
    const client = getClient(db);
    return client.bulkEditIntent.upsert({
      where: {
        shop_operationId: {
          shop,
          operationId,
        },
      },
      update: {
        intentVersion,
        mirrorBatchId,
        filterAst,
        actionAst,
        stableSort,
        canonicalIntentJson,
        canonicalFilterHash,
        canonicalActionHash,
        intentHash,
        plannerVersion,
        compilerVersion,
      },
      create: {
        shop,
        operationId,
        intentVersion,
        mirrorBatchId,
        filterAst,
        actionAst,
        stableSort,
        canonicalIntentJson,
        canonicalFilterHash,
        canonicalActionHash,
        intentHash,
        plannerVersion,
        compilerVersion,
      },
    });
  },

  async upsertByOperation(data, db = prisma) {
    const client = getClient(db);
    return client.bulkEditIntent.upsert({
      where: {
        shop_operationId: {
          shop: data.shop,
          operationId: data.operationId,
        },
      },
      update: {
        ...data,
      },
      create: {
        ...data,
      },
    });
  },
};
