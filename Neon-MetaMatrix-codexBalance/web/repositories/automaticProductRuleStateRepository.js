import { Prisma } from "../generated/prisma/index.js";
import { prisma } from "../config/database.js";

const PRODUCT_ID_CHUNK_SIZE = 1000;
const WRITE_CHUNK_SIZE = 500;
const MAX_BATCH_SIZE = 10_000;

function getClient(db) {
  return db || prisma;
}

function assertShop(shop) {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required for automatic product rule state access");
  }
}

function assertRuleId(automaticProductRuleId) {
  if (!automaticProductRuleId || typeof automaticProductRuleId !== "string") {
    throw new Error("automaticProductRuleId is required");
  }
}

function normalizeProductIds(productIds = []) {
  return [...new Set(productIds.filter(Boolean).map(String))];
}

function chunk(items = [], size = PRODUCT_ID_CHUNK_SIZE) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function assertDate(value, fieldName) {
  if (value !== null && value !== undefined && (!(value instanceof Date) || Number.isNaN(value.getTime()))) {
    throw new Error(`${fieldName} must be a valid Date`);
  }
}

function normalizeRows(rows = []) {
  if (rows.length > MAX_BATCH_SIZE) {
    throw new Error(`Automatic rule state batch is limited to ${MAX_BATCH_SIZE} rows`);
  }

  return rows
    .filter((row) => row?.productId)
    .map((row) => ({
      ...row,
      productId: String(row.productId),
    }));
}

async function assertRuleBelongsToShop(client, automaticProductRuleId, shop) {
  const rule = await client.automaticProductRule.findFirst({
    where: {
      id: automaticProductRuleId,
      shop,
      isDeleted: false,
    },
    select: { id: true },
  });

  if (!rule) {
    throw new Error("Automatic product rule does not belong to shop");
  }
}

async function assertProductsBelongToShop(client, shop, productIds, mirrorBatchId = null) {
  const ids = normalizeProductIds(productIds);
  if (!ids.length) return;

  for (const idsChunk of chunk(ids)) {
    const products = await client.product.findMany({
      where: {
        shop,
        id: { in: idsChunk },
        deletedAt: null,
        ...(mirrorBatchId ? { mirrorBatchId } : {}),
      },
      select: { id: true },
      distinct: ["id"],
    });

    if (products.length !== idsChunk.length) {
      throw new Error("Automatic rule state references products outside the shop or catalog snapshot");
    }
  }
}

export const automaticProductRuleStateRepository = {
  async findByRuleAndProductIds(
    automaticProductRuleId,
    shop,
    productIds = [],
    opts = {},
    db = prisma,
  ) {
    assertRuleId(automaticProductRuleId);
    assertShop(shop);
    const ids = normalizeProductIds(productIds);
    if (!ids.length) return [];

    const client = getClient(db);
    const results = [];
    for (const idsChunk of chunk(ids)) {
      const states = await client.automaticProductRuleProductState.findMany({
        where: {
          automaticProductRuleId,
          shop,
          productId: { in: idsChunk },
          ...(opts.mirrorBatchId ? { mirrorBatchId: opts.mirrorBatchId } : {}),
        },
        select: opts.select,
      });
      results.push(...states);
    }

    return results;
  },

  async upsertState({ automaticProductRuleId, shop, productId, data, guard = {} }, db = prisma) {
    const [state] = await this.bulkUpsertStates({
      automaticProductRuleId,
      shop,
      rows: [{ productId, data }],
      mirrorBatchId: data?.mirrorBatchId,
      runId: data?.lastRunId,
      executionKey: data?.lastExecutionKey,
      guard,
    }, db);

    return state || null;
  },

  async bulkUpsertStates({
    automaticProductRuleId,
    shop,
    rows = [],
    mirrorBatchId = null,
    runId = null,
    executionKey = null,
    guard = {},
  }, db = prisma) {
    assertRuleId(automaticProductRuleId);
    assertShop(shop);
    assertDate(guard.updatedAtLte, "guard.updatedAtLte");

    const client = getClient(db);
    const normalizedRows = normalizeRows(rows);
    if (!normalizedRows.length) return [];

    await assertRuleBelongsToShop(client, automaticProductRuleId, shop);
    await assertProductsBelongToShop(
      client,
      shop,
      normalizedRows.map((row) => row.productId),
      mirrorBatchId,
    );

    const writtenStates = [];
    for (const rowsChunk of chunk(normalizedRows, WRITE_CHUNK_SIZE)) {
      const operations = rowsChunk.map((row) => {
        const data = {
          ...row.data,
          mirrorBatchId: row.data?.mirrorBatchId ?? mirrorBatchId,
          lastRunId: row.data?.lastRunId ?? runId,
          lastExecutionKey: row.data?.lastExecutionKey ?? executionKey,
        };

        if (guard.updatedAtLte) {
          return client.automaticProductRuleProductState.updateMany({
            where: {
              automaticProductRuleId,
              shop,
              productId: row.productId,
              updatedAt: { lte: guard.updatedAtLte },
            },
            data,
          });
        }

        return client.automaticProductRuleProductState.upsert({
          where: {
            automaticProductRuleId_shop_productId: {
              automaticProductRuleId,
              shop,
              productId: row.productId,
            },
          },
          update: data,
          create: {
            automaticProductRuleId,
            shop,
            productId: row.productId,
            ...data,
          },
        });
      });

      const results = await client.$transaction(operations);
      writtenStates.push(...results);
    }

    return writtenStates;
  },

  async deleteByRule(automaticProductRuleId, shop, db = prisma) {
    assertRuleId(automaticProductRuleId);
    assertShop(shop);

    return getClient(db).automaticProductRuleProductState.deleteMany({
      where: { automaticProductRuleId, shop },
    });
  },

  async pruneDeletedProductState(shop, mirrorBatchId = null, db = prisma) {
    assertShop(shop);
    const client = getClient(db);

    return client.$executeRaw`
      DELETE FROM "AutomaticProductRuleProductState" state
      WHERE state."shop" = ${shop}
        AND (${mirrorBatchId}::text IS NULL OR state."mirrorBatchId" = ${mirrorBatchId})
        AND NOT EXISTS (
          SELECT 1
          FROM "Product" product
          WHERE product."shop" = state."shop"
            AND product."id" = state."productId"
            AND product."deletedAt" IS NULL
            AND (${mirrorBatchId}::text IS NULL OR product."mirrorBatchId" = ${mirrorBatchId})
        )
    `;
  },

  async listChangedSince(automaticProductRuleId, shop, changedSince, opts = {}, db = prisma) {
    assertRuleId(automaticProductRuleId);
    assertShop(shop);
    assertDate(changedSince, "changedSince");

    return getClient(db).automaticProductRuleProductState.findMany({
      where: {
        automaticProductRuleId,
        shop,
        updatedAt: { gt: changedSince },
        ...(opts.mirrorBatchId ? { mirrorBatchId: opts.mirrorBatchId } : {}),
      },
      select: opts.select,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: Math.min(Number.parseInt(opts.limit, 10) || 100, 1000),
    });
  },

  async lockStatesForProducts(automaticProductRuleId, shop, productIds = [], db = prisma) {
    assertRuleId(automaticProductRuleId);
    assertShop(shop);
    const ids = normalizeProductIds(productIds);
    if (!ids.length) return [];

    const lockedRows = [];
    for (const idsChunk of chunk(ids)) {
      const rows = await getClient(db).$queryRaw`
        SELECT *
        FROM "AutomaticProductRuleProductState"
        WHERE "automaticProductRuleId" = ${automaticProductRuleId}
          AND "shop" = ${shop}
          AND "productId" IN (${Prisma.join(idsChunk)})
        FOR UPDATE
      `;
      lockedRows.push(...rows);
    }

    return lockedRows;
  },
};
