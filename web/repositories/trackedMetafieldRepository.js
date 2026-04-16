import { prisma } from "../Config/database.js";

/**
 * TrackedMetafield repository.
 *
 * Prisma-only boundary over ProductTrackedMetafield and VariantTrackedMetafield.
 */

const assertShop = (shop) => {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required");
  }
};

const assertBatchId = (catalogBatchId) => {
  if (!catalogBatchId || typeof catalogBatchId !== "string") {
    throw new Error("catalogBatchId is required");
  }
};

const mapProductRow = (row) => ({
  shop: row.shop,
  catalogBatchId: row.catalogBatchId,
  productId: row.productId || row.ownerId,
  namespace: row.namespace,
  key: row.key,
  type: row.type || null,
  value: row.value || null,
  sourceUpdatedAt: row.sourceUpdatedAt || null,
  sourceEventAt: row.sourceEventAt || null,
});

const mapVariantRow = (row) => ({
  shop: row.shop,
  catalogBatchId: row.catalogBatchId,
  variantId: row.variantId || row.ownerId,
  productId: row.productId || null,
  namespace: row.namespace,
  key: row.key,
  type: row.type || null,
  value: row.value || null,
  sourceUpdatedAt: row.sourceUpdatedAt || null,
  sourceEventAt: row.sourceEventAt || null,
});

const normalizeProductMetafield = (row) => ({
  ...row,
  ownerType: "PRODUCT",
  ownerId: row.productId,
});

const normalizeVariantMetafield = (row) => ({
  ...row,
  ownerType: "VARIANT",
  ownerId: row.variantId,
});

const getOwnerType = (ownerType) => {
  if (!ownerType) return null;

  return String(ownerType).trim().toUpperCase();
};

const assertMetafieldRow = (row) => {
  assertShop(row?.shop);
  assertBatchId(row?.catalogBatchId);

  if (!row.namespace || !row.key) {
    throw new Error("namespace and key are required");
  }
};

export const createManyTrackedMetafields = async (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("rows must be a non-empty array");
  }

  const productRows = [];
  const variantRows = [];

  for (const row of rows) {
    assertMetafieldRow(row);

    const ownerType = getOwnerType(row.ownerType);

    if (ownerType === "PRODUCT") {
      productRows.push(mapProductRow(row));
      continue;
    }

    if (ownerType === "VARIANT") {
      variantRows.push(mapVariantRow(row));
      continue;
    }

    throw new Error("ownerType must be PRODUCT or VARIANT");
  }

  const productResult = await prisma.$transaction(async (tx) => {
    let count = 0;

    for (const row of productRows) {
      const where = {
        shop_catalogBatchId_productId_namespace_key: {
          shop: row.shop,
          catalogBatchId: row.catalogBatchId,
          productId: row.productId,
          namespace: row.namespace,
          key: row.key,
        },
      };
      const existing = await tx.productTrackedMetafield.findUnique({
        where,
        select: { sourceUpdatedAt: true },
      });

      if (
        existing?.sourceUpdatedAt &&
        row.sourceUpdatedAt &&
        existing.sourceUpdatedAt > row.sourceUpdatedAt
      ) {
        continue;
      }

      await tx.productTrackedMetafield.upsert({
        where,
        create: row,
        update: row,
      });
      count += 1;
    }

    return { count };
  });

  const variantResult = await prisma.$transaction(async (tx) => {
    let count = 0;

    for (const row of variantRows) {
      const where = {
        shop_catalogBatchId_variantId_namespace_key: {
          shop: row.shop,
          catalogBatchId: row.catalogBatchId,
          variantId: row.variantId,
          namespace: row.namespace,
          key: row.key,
        },
      };
      const existing = await tx.variantTrackedMetafield.findUnique({
        where,
        select: { sourceUpdatedAt: true },
      });

      if (
        existing?.sourceUpdatedAt &&
        row.sourceUpdatedAt &&
        existing.sourceUpdatedAt > row.sourceUpdatedAt
      ) {
        continue;
      }

      await tx.variantTrackedMetafield.upsert({
        where,
        create: row,
        update: row,
      });
      count += 1;
    }

    return { count };
  });

  return {
    count: productResult.count + variantResult.count,
    productCount: productResult.count,
    variantCount: variantResult.count,
  };
};

export const listTrackedMetafieldsByBatch = async (
  { shop, catalogBatchId, ownerType = null, ownerId = null },
  options = {},
) => {
  assertShop(shop);
  assertBatchId(catalogBatchId);

  const normalizedOwnerType = getOwnerType(ownerType);

  if (normalizedOwnerType === "PRODUCT") {
    const rows = await prisma.productTrackedMetafield.findMany({
      where: {
        shop,
        catalogBatchId,
        ...(ownerId ? { productId: ownerId } : {}),
      },
      orderBy: [{ productId: "asc" }, { namespace: "asc" }, { key: "asc" }],
      select: options.select || undefined,
    });

    return options.select ? rows : rows.map(normalizeProductMetafield);
  }

  if (normalizedOwnerType === "VARIANT") {
    const rows = await prisma.variantTrackedMetafield.findMany({
      where: {
        shop,
        catalogBatchId,
        ...(ownerId ? { variantId: ownerId } : {}),
      },
      orderBy: [{ variantId: "asc" }, { namespace: "asc" }, { key: "asc" }],
      select: options.select || undefined,
    });

    return options.select ? rows : rows.map(normalizeVariantMetafield);
  }

  const [productRows, variantRows] = await Promise.all([
    prisma.productTrackedMetafield.findMany({
      where: {
        shop,
        catalogBatchId,
      },
      orderBy: [{ productId: "asc" }, { namespace: "asc" }, { key: "asc" }],
    }),
    prisma.variantTrackedMetafield.findMany({
      where: {
        shop,
        catalogBatchId,
      },
      orderBy: [{ variantId: "asc" }, { namespace: "asc" }, { key: "asc" }],
    }),
  ]);

  return [
    ...productRows.map(normalizeProductMetafield),
    ...variantRows.map(normalizeVariantMetafield),
  ];
};

export const deleteTrackedMetafieldsByBatch = async ({
  shop,
  catalogBatchId,
}) => {
  assertShop(shop);
  assertBatchId(catalogBatchId);

  const [productResult, variantResult] = await Promise.all([
    prisma.productTrackedMetafield.deleteMany({
      where: {
        shop,
        catalogBatchId,
      },
    }),
    prisma.variantTrackedMetafield.deleteMany({
      where: {
        shop,
        catalogBatchId,
      },
    }),
  ]);

  return {
    count: productResult.count + variantResult.count,
    productCount: productResult.count,
    variantCount: variantResult.count,
  };
};
