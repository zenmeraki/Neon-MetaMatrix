import { prisma } from "../config/database.js";

const MAX_PRODUCT_IDS_PER_QUERY = 500;
const CHUNK_FETCH_CONCURRENCY = 4;

function getClient(db) {
  return db || prisma;
}

function normalizeProductIds(productIds) {
  if (!Array.isArray(productIds)) return [];

  return [...new Set(productIds.filter((id) => typeof id === "string" && id.trim()))];
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

function withSoftDeleteGuard(where) {
  return {
    ...where,
    deletedAt: null,
  };
}

export const productMirrorRepository = {
  async findProductsPageForExport(
    { shop, mirrorBatchId, productIds = [], cursorId = null, pageSize = 500 },
    db = prisma,
  ) {
    if (!shop) throw new Error("shop is required");
    if (!mirrorBatchId) throw new Error("mirrorBatchId is required");

    const safeProductIds = Array.isArray(productIds)
      ? [...new Set(productIds.filter(Boolean))]
      : [];

    const idFilter = {
      ...(safeProductIds.length ? { in: safeProductIds } : {}),
      ...(cursorId ? { gt: cursorId } : {}),
    };

    return getClient(db).product.findMany({
      where: {
        shop,
        mirrorBatchId,
        deletedAt: null,
        ...(Object.keys(idFilter).length ? { id: idFilter } : {}),
      },
      include: {
        variants: {
          where: {
            shop,
            mirrorBatchId,
            deletedAt: null,
          },
          orderBy: [{ position: "asc" }, { id: "asc" }],
        },
      },
      orderBy: { id: "asc" },
      take: Math.min(Number(pageSize) || 500, 500),
    });
  },

  async findProductsForFrozenTarget(
    { shop, productIds, mirrorBatchId, includeVariants = false },
    db = prisma,
  ) {
    const client = getClient(db);
    const safeMirrorBatchId = assertMirrorBatchId(mirrorBatchId);
    const ids = normalizeProductIds(productIds);

    if (!shop) {
      throw new Error("shop is required for mirror product hydration");
    }

    if (!ids.length) return [];

    const results = await fetchChunked(ids, MAX_PRODUCT_IDS_PER_QUERY, (idChunk) =>
      client.product.findMany({
        where: withSoftDeleteGuard({
          shop,
          mirrorBatchId: safeMirrorBatchId,
          id: { in: idChunk },
        }),
        ...(includeVariants
          ? {
              include: {
                variants: {
                  where: withSoftDeleteGuard({
                    shop,
                    mirrorBatchId: safeMirrorBatchId,
                  }),
                  orderBy: [{ productId: "asc" }, { position: "asc" }, { id: "asc" }],
                },
              },
            }
          : {}),
      }),
    );

    const productById = new Map(results.map((product) => [product.id, product]));

    return ids.map((id) => productById.get(id)).filter(Boolean);
  },

  async findVariantsForProducts(
    { shop, productIds, mirrorBatchId },
    db = prisma,
  ) {
    const client = getClient(db);
    const safeMirrorBatchId = assertMirrorBatchId(mirrorBatchId);
    const ids = normalizeProductIds(productIds);

    if (!shop) {
      throw new Error("shop is required for mirror variant hydration");
    }

    if (!ids.length) return [];

    return fetchChunked(ids, MAX_PRODUCT_IDS_PER_QUERY, (idChunk) =>
      client.variant.findMany({
        where: withSoftDeleteGuard({
          shop,
          mirrorBatchId: safeMirrorBatchId,
          productId: { in: idChunk },
        }),
        orderBy: [{ productId: "asc" }, { position: "asc" }, { id: "asc" }],
      }),
    );
  },
};
