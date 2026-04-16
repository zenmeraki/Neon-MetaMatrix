import { prisma } from "../Config/database.js";

/**
 * Product mirror repository.
 *
 * Responsibilities:
 * - Prisma access for Product mirror rows only
 * - batch-scoped product lookup/count/create/delete helpers
 *
 * No responsibilities:
 * - Shopify API calls
 * - ingestion orchestration
 * - snapshot activation
 */

const DEFAULT_SELECT = {
  shop: true,
  id: true,
  mirrorBatchId: true,
  catalogBatchId: true,
  title: true,
  handle: true,
  status: true,
  productType: true,
  vendor: true,
  tags: true,
  templateSuffix: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  totalInventory: true,
  categoryId: true,
  categoryName: true,
  variantCount: true,
  visibleOnlineStore: true,
  lastSourceUpdatedAt: true,
  lastReconciledAt: true,
};

const assertShop = (shop) => {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required");
  }
};

const assertBatchId = (mirrorBatchId) => {
  if (!mirrorBatchId || typeof mirrorBatchId !== "string") {
    throw new Error("mirrorBatchId is required");
  }
};

const assertProductId = (productId) => {
  if (!productId || typeof productId !== "string") {
    throw new Error("productId is required");
  }
};

const buildSelect = (select) => select || DEFAULT_SELECT;

export const findProductMirrorById = async ({
  shop,
  productId,
  mirrorBatchId,
}, options = {}) => {
  assertShop(shop);
  assertProductId(productId);
  assertBatchId(mirrorBatchId);

  return prisma.product.findUnique({
    where: {
      shop_id_mirrorBatchId: {
        shop,
        id: productId,
        mirrorBatchId,
      },
    },
    select: buildSelect(options.select),
  });
};

export const listProductMirrorsByBatch = async ({
  shop,
  mirrorBatchId,
  cursor = null,
  take = 100,
}, options = {}) => {
  assertShop(shop);
  assertBatchId(mirrorBatchId);

  const safeTake = typeof take === "number" && take > 0
    ? Math.min(take, 500)
    : 100;

  return prisma.product.findMany({
    where: {
      shop,
      mirrorBatchId,
    },
    orderBy: [{ id: "asc" }],
    ...(cursor ? { cursor: { shop_id_mirrorBatchId: cursor }, skip: 1 } : {}),
    take: safeTake,
    select: buildSelect(options.select),
  });
};

export const countProductMirrorsByBatch = async ({ shop, mirrorBatchId }) => {
  assertShop(shop);
  assertBatchId(mirrorBatchId);

  return prisma.product.count({
    where: {
      shop,
      mirrorBatchId,
    },
  });
};

export const createManyProductMirrors = async (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("rows must be a non-empty array");
  }

  for (const row of rows) {
    assertShop(row?.shop);
    assertProductId(row?.id);
    assertBatchId(row?.mirrorBatchId);
  }

  return prisma.product.createMany({
    data: rows.map((row) => ({
      ...row,
      catalogBatchId: row.catalogBatchId || row.mirrorBatchId,
    })),
    skipDuplicates: true,
  });
};

export const deleteProductMirrorsByBatch = async ({ shop, mirrorBatchId }) => {
  assertShop(shop);
  assertBatchId(mirrorBatchId);

  return prisma.product.deleteMany({
    where: {
      shop,
      mirrorBatchId,
    },
  });
};

export const findLatestProductSourceUpdatedAtByBatch = async ({
  shop,
  mirrorBatchId,
}) => {
  assertShop(shop);
  assertBatchId(mirrorBatchId);

  return prisma.product.findFirst({
    where: {
      shop,
      mirrorBatchId,
      lastSourceUpdatedAt: {
        not: null,
      },
    },
    orderBy: { lastSourceUpdatedAt: "desc" },
    select: {
      id: true,
      lastSourceUpdatedAt: true,
    },
  });
};
