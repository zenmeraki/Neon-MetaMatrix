import { prisma } from "../config/database.js";

const MAX_PRODUCT_IDS_PER_QUERY = 500;
const CHUNK_FETCH_CONCURRENCY = 4;
const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 500;
const PRODUCT_SUMMARY_SELECT = Object.freeze({
  id: true,
  title: true,
  handle: true,
  status: true,
  vendor: true,
  productType: true,
  totalInventory: true,
  featuredImageUrl: true,
  variantCount: true,
  categoryName: true,
});
const PRODUCT_DETAIL_SELECT = Object.freeze({
  ...PRODUCT_SUMMARY_SELECT,
  tags: true,
  templateSuffix: true,
  descriptionHtml: true,
  descriptionText: true,
  seoTitle: true,
  seoDescription: true,
  optionsJson: true,
  collectionsJson: true,
  option1Name: true,
  option2Name: true,
  option3Name: true,
  variants: {
    where: {
      deletedAt: null,
    },
    select: {
      id: true,
      productId: true,
      title: true,
      sku: true,
      barcode: true,
      price: true,
      compareAtPrice: true,
      inventoryQuantity: true,
      inventoryPolicy: true,
      taxable: true,
      position: true,
      selectedOptionsJson: true,
      option1Value: true,
      option2Value: true,
      option3Value: true,
      weight: true,
      weightUnit: true,
    },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  },
});

function getClient(db) {
  return db || prisma;
}

function normalizeProductIds(productIds) {
  if (!Array.isArray(productIds)) return [];

  return [
    ...new Set(
      productIds
        .filter((id) => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
}

function assertShop(shop) {
  if (typeof shop !== "string" || !shop.trim()) {
    throw new Error("shop is required");
  }

  return shop.trim();
}

function assertMirrorBatchId(mirrorBatchId) {
  if (typeof mirrorBatchId !== "string" || !mirrorBatchId.trim()) {
    throw new Error("mirrorBatchId is required for mirror-safe product hydration");
  }

  return mirrorBatchId.trim();
}

function normalizePageSize(pageSize) {
  const parsed = Number(pageSize);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(Math.floor(parsed), MAX_PAGE_SIZE);
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

function withSoftDeleteGuard(where) {
  return {
    ...where,
    deletedAt: null,
  };
}

function assertNoMissingProducts({ requestedIds, products, context }) {
  const foundIds = new Set(products.map((product) => product.id));
  const missingIds = requestedIds.filter((id) => !foundIds.has(id));

  if (missingIds.length) {
    const preview = missingIds.slice(0, 20).join(", ");

    throw new Error(
      `${context}: ${missingIds.length} frozen product target(s) missing from mirror batch. First missing ids: ${preview}`,
    );
  }
}

export const productMirrorRepository = {
  async findProductsPageForExport(
    { shop, mirrorBatchId, productIds = [], cursorId = null, pageSize = DEFAULT_PAGE_SIZE },
    db = prisma,
  ) {
    const safeShop = assertShop(shop);
    const safeMirrorBatchId = assertMirrorBatchId(mirrorBatchId);
    const safePageSize = normalizePageSize(pageSize);
    const safeProductIds = normalizeProductIds(productIds);

    const idWhere = {};

    if (safeProductIds.length) {
      idWhere.in = safeProductIds;
    }

    if (typeof cursorId === "string" && cursorId.trim()) {
      idWhere.gt = cursorId.trim();
    }

    return getClient(db).product.findMany({
      where: {
        shop: safeShop,
        mirrorBatchId: safeMirrorBatchId,
        deletedAt: null,
        ...(Object.keys(idWhere).length ? { id: idWhere } : {}),
      },
      include: {
        variants: {
          where: {
            shop: safeShop,
            mirrorBatchId: safeMirrorBatchId,
            deletedAt: null,
          },
          orderBy: [{ position: "asc" }, { id: "asc" }],
        },
      },
      orderBy: [{ id: "asc" }],
      take: safePageSize,
    });
  },

  async findProductsForFrozenTarget(
    { shop, productIds, mirrorBatchId, includeVariants = false, requireAll = true },
    db = prisma,
  ) {
    const client = getClient(db);
    const safeShop = assertShop(shop);
    const safeMirrorBatchId = assertMirrorBatchId(mirrorBatchId);
    const ids = normalizeProductIds(productIds);

    if (!ids.length) return [];

    const results = await fetchChunked(ids, MAX_PRODUCT_IDS_PER_QUERY, (idChunk) =>
      client.product.findMany({
        where: withSoftDeleteGuard({
          shop: safeShop,
          mirrorBatchId: safeMirrorBatchId,
          id: { in: idChunk },
        }),
        ...(includeVariants
          ? {
              include: {
                variants: {
                  where: withSoftDeleteGuard({
                    shop: safeShop,
                    mirrorBatchId: safeMirrorBatchId,
                  }),
                  orderBy: [{ productId: "asc" }, { position: "asc" }, { id: "asc" }],
                },
              },
            }
          : {}),
      }),
    );

    if (requireAll) {
      assertNoMissingProducts({
        requestedIds: ids,
        products: results,
        context: "findProductsForFrozenTarget",
      });
    }

    const productById = new Map(results.map((product) => [product.id, product]));

    return ids.map((id) => productById.get(id)).filter(Boolean);
  },

  async findProductSummariesForFrozenTarget(
    { shop, productIds, mirrorBatchId, requireAll = true },
    db = prisma,
  ) {
    const client = getClient(db);
    const safeShop = assertShop(shop);
    const safeMirrorBatchId = assertMirrorBatchId(mirrorBatchId);
    const ids = normalizeProductIds(productIds);

    if (!ids.length) return [];

    const results = await fetchChunked(ids, MAX_PRODUCT_IDS_PER_QUERY, (idChunk) =>
      client.product.findMany({
        where: withSoftDeleteGuard({
          shop: safeShop,
          mirrorBatchId: safeMirrorBatchId,
          id: { in: idChunk },
        }),
        select: PRODUCT_SUMMARY_SELECT,
      }),
    );

    if (requireAll) {
      assertNoMissingProducts({
        requestedIds: ids,
        products: results,
        context: "findProductSummariesForFrozenTarget",
      });
    }

    const productById = new Map(results.map((product) => [product.id, product]));

    return ids.map((id) => productById.get(id)).filter(Boolean);
  },

  async findProductDetail({ shop, productId, mirrorBatchId }, db = prisma) {
    const safeShop = assertShop(shop);
    const safeMirrorBatchId = assertMirrorBatchId(mirrorBatchId);
    const safeProductId =
      typeof productId === "string" && productId.trim() ? productId.trim() : "";
    if (!safeProductId) {
      throw new Error("productId is required");
    }

    return getClient(db).product.findFirst({
      where: withSoftDeleteGuard({
        shop: safeShop,
        mirrorBatchId: safeMirrorBatchId,
        id: safeProductId,
      }),
      select: {
        ...PRODUCT_DETAIL_SELECT,
        variants: {
          ...PRODUCT_DETAIL_SELECT.variants,
          where: withSoftDeleteGuard({
            shop: safeShop,
            mirrorBatchId: safeMirrorBatchId,
          }),
        },
      },
    });
  },

  async findVariantsForProducts({ shop, productIds, mirrorBatchId }, db = prisma) {
    const client = getClient(db);
    const safeShop = assertShop(shop);
    const safeMirrorBatchId = assertMirrorBatchId(mirrorBatchId);
    const ids = normalizeProductIds(productIds);

    if (!ids.length) return [];

    return fetchChunked(ids, MAX_PRODUCT_IDS_PER_QUERY, (idChunk) =>
      client.variant.findMany({
        where: withSoftDeleteGuard({
          shop: safeShop,
          mirrorBatchId: safeMirrorBatchId,
          productId: { in: idChunk },
        }),
        orderBy: [{ productId: "asc" }, { position: "asc" }, { id: "asc" }],
      }),
    );
  },

  async findFrozenTargetsPageByOrdinal(
    {
      shop,
      mirrorBatchId,
      snapshotSetId,
      afterOrdinal = 0,
      pageSize = DEFAULT_PAGE_SIZE,
      includeVariants = false,
      requireAll = true,
    },
    db = prisma,
  ) {
    const client = getClient(db);
    const safeShop = assertShop(shop);
    const safeMirrorBatchId = assertMirrorBatchId(mirrorBatchId);
    const safePageSize = normalizePageSize(pageSize);
    const safeAfterOrdinal = Math.max(0, Math.floor(Number(afterOrdinal) || 0));

    if (typeof snapshotSetId !== "string" || !snapshotSetId.trim()) {
      throw new Error("snapshotSetId is required");
    }

    const targets = await client.immutableTargetSnapshotItem.findMany({
      where: {
        shop: safeShop,
        snapshotSetId: snapshotSetId.trim(),
        ordinal: { gt: safeAfterOrdinal },
      },
      select: {
        ordinal: true,
        productId: true,
        variantId: true,
      },
      orderBy: [{ ordinal: "asc" }],
      take: safePageSize,
    });

    if (!targets.length) {
      return {
        targets: [],
        products: [],
        nextAfterOrdinal: null,
      };
    }

    const productIds = normalizeProductIds(targets.map((target) => target.productId));
    const products = await this.findProductsForFrozenTarget(
      {
        shop: safeShop,
        productIds,
        mirrorBatchId: safeMirrorBatchId,
        includeVariants,
        requireAll,
      },
      client,
    );

    return {
      targets,
      products,
      nextAfterOrdinal: targets[targets.length - 1]?.ordinal ?? null,
    };
  },
};
