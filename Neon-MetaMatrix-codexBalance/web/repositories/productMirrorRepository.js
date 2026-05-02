import { prisma } from "../config/database.js";
import { Prisma } from "../generated/prisma/index.js";

const MAX_PRODUCT_IDS_PER_QUERY = 500;
const CHUNK_FETCH_CONCURRENCY = 4;
const MAX_EXPORT_PAGE_SIZE = 1000;

const PRODUCT_COLUMNS_SQL = Prisma.sql`
  p."shop",
  p."id",
  p."mirrorBatchId",
  p."deletedAt",
  p."title",
  p."handle",
  p."status",
  p."productType",
  p."vendor",
  p."tags",
  p."templateSuffix",
  p."descriptionHtml",
  p."descriptionText",
  p."createdAt",
  p."updatedAt",
  p."publishedAt",
  p."seoTitle",
  p."seoDescription",
  p."totalInventory",
  p."categoryId",
  p."categoryName",
  p."googleShoppingEnabled",
  p."googleShoppingAgeGroup",
  p."googleShoppingCategory",
  p."googleShoppingColor",
  p."googleShoppingCondition",
  p."googleShoppingCustomLabel0",
  p."googleShoppingCustomLabel1",
  p."googleShoppingCustomLabel2",
  p."googleShoppingCustomLabel3",
  p."googleShoppingCustomLabel4",
  p."googleShoppingCustomProduct",
  p."googleShoppingGender",
  p."googleShoppingMpn",
  p."googleShoppingMaterial",
  p."googleShoppingSize",
  p."googleShoppingSizeSystem",
  p."googleShoppingSizeType",
  p."categoryAgeGroup",
  p."categoryColor",
  p."categoryFabric",
  p."categoryFit",
  p."categorySize",
  p."categoryTargetGender",
  p."categoryWaistRise",
  p."featuredImageUrl",
  p."featuredImageAltText",
  p."optionsJson",
  p."collectionsJson",
  p."option1Name",
  p."option2Name",
  p."option3Name",
  p."variantCount",
  p."visibleOnlineStore",
  p."lastSourceUpdatedAt",
  p."lastSourceEventAt",
  p."lastSourceKind",
  p."lastReconciledAt"
`;

const VARIANT_COLUMNS_SQL = Prisma.sql`
  v."shop",
  v."id",
  v."productId",
  v."mirrorBatchId",
  v."deletedAt",
  v."title",
  v."sku",
  v."barcode",
  v."price",
  v."compareAtPrice",
  v."inventoryQuantity",
  v."inventoryPolicy",
  v."taxable",
  v."taxCode",
  v."position",
  v."selectedOptionsJson",
  v."cost",
  v."countryOfOrigin",
  v."hsTariffCode",
  v."weight",
  v."weightUnit",
  v."option1Value",
  v."option2Value",
  v."option3Value",
  v."physicalProduct",
  v."profitMargin",
  v."tracked"
`;

function getClient(db) {
  return db || prisma;
}

function normalizeProductIds(productIds) {
  if (!Array.isArray(productIds)) return [];

  return [...new Set(productIds
    .filter((id) => typeof id === "string" && id.trim())
    .map((id) => id.trim()))];
}

function assertShop(shop) {
  if (typeof shop !== "string" || !shop.trim()) {
    throw new Error("shop is required for mirror-safe product hydration");
  }

  return shop.trim();
}

function assertMirrorBatchId(mirrorBatchId) {
  if (typeof mirrorBatchId !== "string" || !mirrorBatchId.trim()) {
    throw new Error("mirrorBatchId is required for mirror-safe product hydration");
  }

  return mirrorBatchId.trim();
}

function chunkArray(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function fetchChunked(items, size, fetcher) {
  const chunks = chunkArray(items, size);
  const chunkResults = [];

  for (let index = 0; index < chunks.length; index += CHUNK_FETCH_CONCURRENCY) {
    const window = chunks.slice(index, index + CHUNK_FETCH_CONCURRENCY);
    const windowResults = await Promise.all(window.map((chunk) => fetcher(chunk)));
    chunkResults.push(...windowResults);
  }

  return chunkResults.flat();
}

function normalizePageSize(pageSize, fallback = 500) {
  const parsed = Number.parseInt(pageSize, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;

  return Math.min(parsed, MAX_EXPORT_PAGE_SIZE);
}

function groupVariantsByProductId(variants) {
  const map = new Map();

  for (const variant of variants) {
    const list = map.get(variant.productId) || [];
    list.push(variant);
    map.set(variant.productId, list);
  }

  return map;
}

async function findProductsByIdsSql({
  client,
  shop,
  mirrorBatchId,
  ids,
  cursorId = null,
  limit = null,
}) {
  if (!ids.length && !cursorId && !limit) return [];

  const idFilter = ids.length
    ? Prisma.sql`AND p."id" IN (${Prisma.join(ids)})`
    : Prisma.empty;
  const cursorFilter = cursorId
    ? Prisma.sql`AND p."id" > ${cursorId}`
    : Prisma.empty;
  const limitSql = limit
    ? Prisma.sql`LIMIT ${limit}`
    : Prisma.empty;

  return client.$queryRaw`
    SELECT ${PRODUCT_COLUMNS_SQL}
    FROM "Product" p
    WHERE p."shop" = ${shop}
      AND p."mirrorBatchId" = ${mirrorBatchId}
      AND p."deletedAt" IS NULL
      ${idFilter}
      ${cursorFilter}
    ORDER BY p."id" ASC
    ${limitSql}
  `;
}

async function findVariantsByProductIdsSql({
  client,
  shop,
  mirrorBatchId,
  ids,
}) {
  if (!ids.length) return [];

  return client.$queryRaw`
    SELECT ${VARIANT_COLUMNS_SQL}
    FROM "Variant" v
    WHERE v."shop" = ${shop}
      AND v."mirrorBatchId" = ${mirrorBatchId}
      AND v."deletedAt" IS NULL
      AND v."productId" IN (${Prisma.join(ids)})
    ORDER BY v."productId" ASC, v."position" ASC, v."id" ASC
  `;
}

async function attachVariants({
  client,
  shop,
  mirrorBatchId,
  products,
  orderedIds,
}) {
  const variants = await findVariantsByProductIdsSql({
    client,
    shop,
    mirrorBatchId,
    ids: orderedIds,
  });

  const variantsByProductId = groupVariantsByProductId(variants);

  return products.map((product) => ({
    ...product,
    variants: variantsByProductId.get(product.id) || [],
  }));
}

export const productMirrorRepository = {
  async findProductsPageForExport(
    { shop, mirrorBatchId, productIds = [], cursorId = null, pageSize = 500 },
    db = prisma,
  ) {
    const client = getClient(db);
    const safeShop = assertShop(shop);
    const safeMirrorBatchId = assertMirrorBatchId(mirrorBatchId);
    const safeProductIds = normalizeProductIds(productIds);
    const safePageSize = normalizePageSize(pageSize, 500);

    const products = await findProductsByIdsSql({
      client,
      shop: safeShop,
      mirrorBatchId: safeMirrorBatchId,
      ids: safeProductIds,
      cursorId,
      limit: safePageSize,
    });

    const orderedIds = safeProductIds.length
      ? safeProductIds.filter((id) => !cursorId || id > cursorId)
      : products.map((product) => product.id);
    const productById = new Map(products.map((product) => [product.id, product]));
    const orderedProducts = orderedIds
      .map((id) => productById.get(id))
      .filter(Boolean)
      .slice(0, safePageSize);

    return attachVariants({
      client,
      shop: safeShop,
      mirrorBatchId: safeMirrorBatchId,
      products: orderedProducts,
      orderedIds: orderedProducts.map((product) => product.id),
    });
  },

  async findProductsPageForTargetSnapshot(
    {
      shop,
      ownerType,
      ownerId,
      cursorOrdinal = 0,
      pageSize = 500,
      includeVariants = true,
    },
    db = prisma,
  ) {
    const client = getClient(db);
    const safeShop = assertShop(shop);
    const safeCursorOrdinal = Math.max(Number.parseInt(cursorOrdinal, 10) || 0, 0);
    const safePageSize = normalizePageSize(pageSize, 500);

    if (!ownerType || !ownerId) {
      throw new Error("ownerType and ownerId are required for target snapshot hydration");
    }

    const rows = await client.$queryRaw`
      SELECT
        ts."ordinal" AS "__targetOrdinal",
        ${PRODUCT_COLUMNS_SQL}
      FROM "TargetSnapshot" ts
      JOIN "Product" p
        ON p."shop" = ts."shop"
       AND p."id" = ts."productId"
       AND p."mirrorBatchId" = ts."mirrorBatchId"
      WHERE ts."shop" = ${safeShop}
        AND ts."ownerType" = ${ownerType}
        AND ts."ownerId" = ${ownerId}
        AND ts."ordinal" > ${safeCursorOrdinal}
        AND p."deletedAt" IS NULL
      ORDER BY ts."ordinal" ASC
      LIMIT ${safePageSize}
    `;

    const products = rows.map(({ __targetOrdinal, ...product }) => product);
    const productIds = products.map((product) => product.id);
    const hydratedProducts = includeVariants
      ? await attachVariants({
          client,
          shop: safeShop,
          mirrorBatchId: products[0]?.mirrorBatchId,
          products,
          orderedIds: productIds,
        })
      : products;

    return {
      products: hydratedProducts,
      lastOrdinal: rows.length
        ? Number(rows[rows.length - 1].__targetOrdinal)
        : safeCursorOrdinal,
      hasMore: rows.length === safePageSize,
    };
  },

  async findProductsForFrozenTarget(
    { shop, productIds, mirrorBatchId, includeVariants = false },
    db = prisma,
  ) {
    const client = getClient(db);
    const safeShop = assertShop(shop);
    const safeMirrorBatchId = assertMirrorBatchId(mirrorBatchId);
    const ids = normalizeProductIds(productIds);

    if (!ids.length) return [];

    const results = await findProductsByIdsSql({
      client,
      shop: safeShop,
      mirrorBatchId: safeMirrorBatchId,
      ids,
    });

    const products = includeVariants
      ? await attachVariants({
          client,
          shop: safeShop,
          mirrorBatchId: safeMirrorBatchId,
          products: results,
          orderedIds: ids,
        })
      : results;

    const productById = new Map(products.map((product) => [product.id, product]));

    return ids.map((id) => productById.get(id)).filter(Boolean);
  },

  async findVariantsForProducts(
    { shop, productIds, mirrorBatchId },
    db = prisma,
  ) {
    const client = getClient(db);
    const safeShop = assertShop(shop);
    const safeMirrorBatchId = assertMirrorBatchId(mirrorBatchId);
    const ids = normalizeProductIds(productIds);

    if (!ids.length) return [];

    return fetchChunked(ids, MAX_PRODUCT_IDS_PER_QUERY, (idChunk) =>
      findVariantsByProductIdsSql({
        client,
        shop: safeShop,
        mirrorBatchId: safeMirrorBatchId,
        ids: idChunk,
      }),
    );
  },
};
