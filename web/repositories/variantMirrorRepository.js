import { prisma } from "../Config/database.js";

/**
 * Variant mirror repository.
 *
 * Responsibilities:
 * - Prisma access for Variant mirror rows only
 * - batch-scoped variant lookup/count/create/delete helpers
 */

const DEFAULT_SELECT = {
  shop: true,
  id: true,
  productId: true,
  mirrorBatchId: true,
  catalogBatchId: true,
  title: true,
  sku: true,
  barcode: true,
  price: true,
  compareAtPrice: true,
  inventoryQuantity: true,
  inventoryPolicy: true,
  taxable: true,
  taxCode: true,
  position: true,
  cost: true,
  countryOfOrigin: true,
  hsTariffCode: true,
  weight: true,
  weightUnit: true,
  tracked: true,
  physicalProduct: true,
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

const assertVariantId = (variantId) => {
  if (!variantId || typeof variantId !== "string") {
    throw new Error("variantId is required");
  }
};

const buildSelect = (select) => select || DEFAULT_SELECT;

export const findVariantMirrorById = async ({
  shop,
  variantId,
  mirrorBatchId,
}, options = {}) => {
  assertShop(shop);
  assertVariantId(variantId);
  assertBatchId(mirrorBatchId);

  return prisma.variant.findUnique({
    where: {
      shop_id_mirrorBatchId: {
        shop,
        id: variantId,
        mirrorBatchId,
      },
    },
    select: buildSelect(options.select),
  });
};

export const listVariantMirrorsByBatch = async ({
  shop,
  mirrorBatchId,
  productId = null,
  take = 100,
}, options = {}) => {
  assertShop(shop);
  assertBatchId(mirrorBatchId);

  const safeTake = typeof take === "number" && take > 0
    ? Math.min(take, 500)
    : 100;

  return prisma.variant.findMany({
    where: {
      shop,
      mirrorBatchId,
      ...(productId ? { productId } : {}),
    },
    orderBy: [{ productId: "asc" }, { position: "asc" }, { id: "asc" }],
    take: safeTake,
    select: buildSelect(options.select),
  });
};

export const countVariantMirrorsByBatch = async ({
  shop,
  mirrorBatchId,
  productId = null,
}) => {
  assertShop(shop);
  assertBatchId(mirrorBatchId);

  return prisma.variant.count({
    where: {
      shop,
      mirrorBatchId,
      ...(productId ? { productId } : {}),
    },
  });
};

export const createManyVariantMirrors = async (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("rows must be a non-empty array");
  }

  for (const row of rows) {
    assertShop(row?.shop);
    assertVariantId(row?.id);
    assertBatchId(row?.mirrorBatchId);
  }

  return prisma.variant.createMany({
    data: rows.map((row) => ({
      ...row,
      catalogBatchId: row.catalogBatchId || row.mirrorBatchId,
      priceDecimal: row.priceDecimal ?? row.price ?? null,
      compareAtPriceDecimal: row.compareAtPriceDecimal ?? row.compareAtPrice ?? null,
      costDecimal: row.costDecimal ?? row.cost ?? null,
      weightDecimal: row.weightDecimal ?? row.weight ?? null,
      profitMarginDecimal: row.profitMarginDecimal ?? row.profitMargin ?? null,
    })),
    skipDuplicates: true,
  });
};

export const deleteVariantMirrorsByBatch = async ({ shop, mirrorBatchId }) => {
  assertShop(shop);
  assertBatchId(mirrorBatchId);

  return prisma.variant.deleteMany({
    where: {
      shop,
      mirrorBatchId,
    },
  });
};
