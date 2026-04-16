import { prisma } from "../Config/database.js";

function getClient(db) {
  return db || prisma;
}

export const automaticProductRuleStateRepository = {
  async findByRuleAndProductIds(automaticProductRuleId, shop, productIds = [], db = prisma) {
    if (!productIds.length) return [];

    return getClient(db).automaticProductRuleProductState.findMany({
      where: {
        automaticProductRuleId,
        shop,
        productId: { in: productIds },
      },
    });
  },

  async upsertState({ automaticProductRuleId, shop, productId, data }, db = prisma) {
    return getClient(db).automaticProductRuleProductState.upsert({
      where: {
        automaticProductRuleId_shop_productId: {
          automaticProductRuleId,
          shop,
          productId,
        },
      },
      update: data,
      create: {
        automaticProductRuleId,
        shop,
        productId,
        ...data,
      },
    });
  },

  async upsertManyStates(automaticProductRuleId, shop, updates = [], db = prisma) {
    if (updates.length === 0) return;
    const client = getClient(db);
    await client.$transaction(
      updates.map(({ productId, ...data }) =>
        client.automaticProductRuleProductState.upsert({
          where: {
            automaticProductRuleId_shop_productId: {
              automaticProductRuleId,
              shop,
              productId,
            },
          },
          update: data,
          create: {
            automaticProductRuleId,
            shop,
            productId,
            ...data,
          },
        }),
      ),
    );
  },
};
