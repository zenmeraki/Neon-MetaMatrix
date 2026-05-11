import { prisma } from "../config/database.js";
import { getSession } from "../utils/sessionHandler.js";
import { adminGraphqlWithRetry } from "../utils/shopifyAdminApi.js";
import logger from "../utils/loggerUtils.js";

const SAMPLE_SIZE = 50;

function normalizeShopifyProduct(node) {
  return {
    id: node?.id,
    title: node?.title || "",
    handle: node?.handle || "",
    status: node?.status || "",
    updatedAt: node?.updatedAt || null,
  };
}

function normalizeMirrorProduct(product) {
  return {
    id: product?.id,
    title: product?.title || "",
    handle: product?.handle || "",
    status: product?.status || "",
    updatedAt: product?.updatedAt ? product.updatedAt.toISOString() : null,
  };
}

async function fetchShopifyProductsByIds(session, ids) {
  const response = await adminGraphqlWithRetry({
    session,
    data: {
      query: `
      query MirrorSample($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            handle
            status
            updatedAt
          }
        }
      }
    `,
      variables: { ids },
    },
    operationName: "catalog-corruption-sample",
  });

  const nodes =
    response?.body?.data?.nodes ||
    response?.data?.nodes ||
    response?.nodes ||
    [];

  return new Map(
    nodes
      .filter(Boolean)
      .map((node) => [node.id, normalizeShopifyProduct(node)]),
  );
}

export const catalogCorruptionDetectionService = {
  async compareMirrorAgainstShopifySample({ shop, sampleSize = SAMPLE_SIZE } = {}) {
    if (!shop) throw new Error("shop is required");

    const store = await prisma.store.findUnique({
      where: { shopUrl: shop },
      select: { activeMirrorBatchId: true },
    });

    if (!store?.activeMirrorBatchId) {
      return { shop, skipped: true, reason: "NO_ACTIVE_MIRROR_BATCH" };
    }

    const session = await getSession(shop);
    if (!session) {
      return { shop, skipped: true, reason: "SHOP_SESSION_NOT_FOUND" };
    }

    const sample = await prisma.product.findMany({
      where: { shop, mirrorBatchId: store.activeMirrorBatchId },
      select: {
        id: true,
        title: true,
        handle: true,
        status: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: sampleSize,
    });

    const shopifyProducts = await fetchShopifyProductsByIds(
      session,
      sample.map((product) => product.id),
    );

    const mismatches = [];
    for (const product of sample) {
      const mirror = normalizeMirrorProduct(product);
      const shopify = shopifyProducts.get(product.id);

      if (!shopify) {
        mismatches.push({ id: product.id, reason: "MISSING_IN_SHOPIFY" });
        continue;
      }

      for (const field of ["title", "handle", "status"]) {
        if (mirror[field] !== shopify[field]) {
          mismatches.push({
            id: product.id,
            field,
            mirror: mirror[field],
            shopify: shopify[field],
          });
        }
      }
    }

    if (mismatches.length) {
      logger.error("Catalog mirror corruption sample mismatch", {
        shop,
        sampleSize: sample.length,
        mismatchCount: mismatches.length,
      });
    }

    return {
      shop,
      sampleSize: sample.length,
      mismatchCount: mismatches.length,
      mismatches,
    };
  },
};
