import { prisma } from "../../config/database.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { adminGraphqlWithRetry } from "../../utils/shopifyAdminApi.js";
import { getSession } from "../../utils/sessionHandler.js";
import { enqueueAutomaticProductRuleSignalJob } from "../automaticProductRuleExecutionService.js";
import { recordMirrorAnomaly } from "../mirrorAnomalyService.js";
import {
  markRepairRequired,
  markWebhookProcessed,
  MIRROR_STALE_REASONS,
} from "../mirrorHealthService.js";
import {
  applyProductFreshness,
  clearProductTombstone,
  getLatestProductFreshness,
  isIncomingProductStateFresh,
  MIRROR_SOURCE_KINDS,
  upsertProductTombstone,
} from "../mirrorFreshnessService.js";
import {
  claimProductReconcileSignal,
  markProductReconcileSignalFailed,
  markProductReconcileSignalProcessed,
} from "../productReconcileSignalService.js";
import {
  extractMetaobjectIds,
  fetchMetaobjectLookupByIdsDetailed,
} from "./productSyncMetaobjects.js";
import {
  extractMetafields,
  extractVariants,
  flattenProduct,
  flattenVariant,
} from "./productSyncTransformers.js";
import { addShopSyncJob } from "../../Jobs/Queues/shopSyncJob.js";

const PRODUCT_RECONCILE_OVERLAP_MS = 10 * 60 * 1000;
const SHOP_INCREMENTAL_PAGE_SIZE = 50;

const PRODUCT_FIELDS = `
  id
  title
  handle
  status
  productType
  vendor
  tags
  templateSuffix
  createdAt
  updatedAt
  publishedAt
  onlineStoreUrl
  descriptionHtml
  seo {
    title
    description
  }
  totalInventory
  category {
    id
    name
  }
  metafields(first: 100) {
    edges {
      node {
        namespace
        key
        type
        value
      }
    }
  }
  options {
    id
    name
    position
    values
  }
  collections(first: 100) {
    edges {
      node {
        id
        title
      }
    }
  }
  featuredMedia {
    ... on MediaImage {
      id
      alt
      preview {
        image {
          url
          altText
        }
      }
    }
  }
  variants(first: 250) {
    edges {
      node {
        id
        title
        sku
        barcode
        price
        compareAtPrice
        inventoryQuantity
        inventoryPolicy
        taxable
        taxCode
        position
        selectedOptions {
          name
          value
        }
        inventoryItem {
          tracked
          requiresShipping
          unitCost {
            amount
          }
          countryCodeOfOrigin
          harmonizedSystemCode
          measurement {
            weight {
              value
              unit
            }
          }
        }
      }
    }
  }
`;

function normalizeTimestamp(value) {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildUpdatedAtQuery(updatedSince) {
  const threshold = normalizeTimestamp(updatedSince) || new Date();
  return `updated_at:>${threshold.toISOString()}`;
}

async function fetchProductById(session, productId) {
  const response = await adminGraphqlWithRetry({
    session,
    shop: session.shop,
    operationName: "productReconcile.fetchProductById",
    data: {
      query: `
        query ProductReconcileById($id: ID!) {
          product(id: $id) {
            ${PRODUCT_FIELDS}
          }
        }
      `,
      variables: {
        id: productId,
      },
    },
  });

  const userErrors = response.body?.errors || [];
  if (userErrors.length) {
    throw new Error(JSON.stringify(userErrors));
  }

  return response.body?.data?.product || null;
}

async function fetchUpdatedProductsPage({ session, updatedSince, after = null }) {
  const response = await adminGraphqlWithRetry({
    session,
    shop: session.shop,
    operationName: "productReconcile.fetchUpdatedProductsPage",
    data: {
      query: `
        query ProductReconcileUpdatedSince($first: Int!, $after: String, $query: String!) {
          products(first: $first, after: $after, sortKey: UPDATED_AT, query: $query) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                ${PRODUCT_FIELDS}
              }
            }
          }
        }
      `,
      variables: {
        first: SHOP_INCREMENTAL_PAGE_SIZE,
        after,
        query: buildUpdatedAtQuery(updatedSince),
      },
    },
  });

  const userErrors = response.body?.errors || [];
  if (userErrors.length) {
    throw new Error(JSON.stringify(userErrors));
  }

  const connection = response.body?.data?.products;
  return {
    products: connection?.edges?.map((edge) => edge?.node).filter(Boolean) || [],
    hasNextPage: Boolean(connection?.pageInfo?.hasNextPage),
    endCursor: connection?.pageInfo?.endCursor || null,
  };
}

async function buildMetaobjectLookup(session, product) {
  const referencedMetaobjectIds = new Set();
  for (const metafield of extractMetafields(product?.metafields)) {
    for (const id of extractMetaobjectIds(metafield?.value)) {
      referencedMetaobjectIds.add(id);
    }
  }

  if (!referencedMetaobjectIds.size) {
    return {
      lookup: new Map(),
      degraded: false,
    };
  }

  const result = await fetchMetaobjectLookupByIdsDetailed(
    session,
    Array.from(referencedMetaobjectIds),
    { bestEffort: true },
  );

  return {
    lookup: result.lookup,
    degraded: result.degraded,
  };
}

async function getActiveMirrorBatchId(shop) {
  const store = await prisma.store.findUnique({
    where: { shopUrl: shop },
    select: {
      activeMirrorBatchId: true,
    },
  });

  return store?.activeMirrorBatchId || null;
}

async function applyProductSnapshot({
  shop,
  session,
  mirrorBatchId,
  product,
  sourceKind,
  sourceUpdatedAt,
  sourceEventAt,
  emitAutomaticRuleSignal = false,
  signalReference = null,
}) {
  const metaobjectResult = await buildMetaobjectLookup(session, product);
  const productRow = flattenProduct(product, shop, metaobjectResult.lookup);
  const variantRows = extractVariants(product.variants).map((variant) =>
    flattenVariant(product.id, variant, shop),
  );

  await prisma.$transaction(async (tx) => {
    await tx.variant.deleteMany({
      where: {
        shop,
        productId: product.id,
        mirrorBatchId,
      },
    });

    await tx.product.deleteMany({
      where: {
        shop,
        id: product.id,
        mirrorBatchId,
      },
    });

    await tx.product.create({
      data: {
        ...productRow,
        shop,
        mirrorBatchId,
      },
    });

    if (variantRows.length) {
      await tx.variant.createMany({
        data: variantRows.map((variant) => ({
          ...variant,
          shop,
          mirrorBatchId,
        })),
      });
    }

    await clearProductTombstone({
      shop,
      productId: product.id,
      client: tx,
    });

    await applyProductFreshness({
      shop,
      productId: product.id,
      mirrorBatchId,
      sourceKind,
      sourceUpdatedAt: sourceUpdatedAt || product.updatedAt || null,
      sourceEventAt,
      lastReconciledAt: new Date(),
      client: tx,
    });
  });

  await markWebhookProcessed(shop, {
    lastIncrementalSyncAt: new Date(),
  }).catch(() => {});

  await clearKeyCaches(`${shop}:ProductFetch:`);
  await clearKeyCaches(`${shop}:productTypes:`);
  await clearKeyCaches(`${shop}:ProductFilterValues:`);
  await clearKeyCaches(`${shop}:sync_details`);

  if (metaobjectResult.degraded) {
    await recordMirrorAnomaly({
      shop,
      severity: "medium",
      type: "metaobject_enrichment_degraded",
      entityType: "product",
      entityId: product.id,
      message: "Metaobject enrichment was incomplete during product reconcile",
      details: {
        sourceKind,
        signalReference,
      },
    }).catch(() => {});
  }

  if (emitAutomaticRuleSignal) {
    await enqueueAutomaticProductRuleSignalJob({
      shop,
      productIds: [product.id],
      triggerReference:
        signalReference ||
        `product_reconcile:${product.id}:${product.updatedAt || ""}`,
      triggerSource: "WEBHOOK",
    }).catch(() => {});
  }
}

async function applyDeletedProduct({
  shop,
  productId,
  mirrorBatchId,
  sourceKind,
  sourceUpdatedAt,
  sourceEventAt,
}) {
  await prisma.$transaction(async (tx) => {
    await tx.variant.deleteMany({
      where: {
        shop,
        productId,
        mirrorBatchId,
      },
    });

    await tx.product.deleteMany({
      where: {
        shop,
        id: productId,
        mirrorBatchId,
      },
    });

    await upsertProductTombstone({
      shop,
      productId,
      sourceKind,
      sourceUpdatedAt,
      sourceEventAt,
      deletedAt: sourceUpdatedAt || sourceEventAt || new Date(),
      lastReconciledAt: new Date(),
      client: tx,
    });
  });

  await markWebhookProcessed(shop, {
    lastIncrementalSyncAt: new Date(),
  }).catch(() => {});

  await clearKeyCaches(`${shop}:ProductFetch:`);
  await clearKeyCaches(`${shop}:productTypes:`);
  await clearKeyCaches(`${shop}:ProductFilterValues:`);
  await clearKeyCaches(`${shop}:sync_details`);
}

export async function reconcileProductById({
  shop,
  productId,
  sourceKind = MIRROR_SOURCE_KINDS.DIRECT_RECONCILE,
  sourceUpdatedAt = null,
  sourceEventAt = null,
  emitAutomaticRuleSignal = false,
  signalReference = null,
  allowMissingAsDelete = false,
}) {
  const mirrorBatchId = await getActiveMirrorBatchId(shop);

  if (!mirrorBatchId) {
    await markRepairRequired({
      shop,
      reason: MIRROR_STALE_REASONS.PARTIAL_MIRROR_DETECTED,
      summary: "Product reconcile requested before an active mirror batch existed",
      details: { productId },
    }).catch(() => {});
    await addShopSyncJob({
      shop,
      syncType: "product",
      reason: "product_reconcile_missing_batch",
    }).catch(() => {});
    return { scheduledRepair: true, reason: "missing_active_mirror_batch" };
  }

  const latestKnown = await getLatestProductFreshness({ shop, productId });
  if (
    !isIncomingProductStateFresh({
      latest: latestKnown,
      sourceUpdatedAt,
      sourceEventAt,
    })
  ) {
    return { skipped: true, reason: "stale_signal" };
  }

  const session = await getSession(shop);
  const product = await fetchProductById(session, productId);

  if (!product) {
    if (!allowMissingAsDelete) {
      throw new Error(
        `Authoritative product fetch returned no product for ${productId}`,
      );
    }

    await applyDeletedProduct({
      shop,
      productId,
      mirrorBatchId,
      sourceKind: MIRROR_SOURCE_KINDS.TOMBSTONE_DELETE,
      sourceUpdatedAt,
      sourceEventAt,
    });

    return {
      success: true,
      deleted: true,
      productId,
    };
  }

  await applyProductSnapshot({
    shop,
    session,
    mirrorBatchId,
    product,
    sourceKind,
    sourceUpdatedAt: sourceUpdatedAt || product.updatedAt || null,
    sourceEventAt,
    emitAutomaticRuleSignal,
    signalReference,
  });

  return {
    success: true,
    deleted: false,
    productId,
  };
}

export async function processProductReconcileSignal({
  shop,
  productId,
  emitAutomaticRuleSignal = true,
}) {
  const signal = await claimProductReconcileSignal({ shop, productId });
  if (!signal) {
    return { skipped: true, reason: "signal_not_claimed" };
  }

  try {
    const result = await reconcileProductById({
      shop,
      productId,
      sourceKind:
        signal.latestSourceKind || MIRROR_SOURCE_KINDS.WEBHOOK_SIGNAL,
      sourceUpdatedAt: signal.latestSourceUpdatedAt,
      sourceEventAt: signal.latestEventAt,
      emitAutomaticRuleSignal,
      signalReference: `${signal.topic || "webhook"}:${productId}:${signal.latestEventAt || ""}`,
      allowMissingAsDelete:
        signal.topic === "PRODUCTS_DELETE" ||
        signal.latestSourceKind === MIRROR_SOURCE_KINDS.WEBHOOK_DELETE,
    });

    const completed = await markProductReconcileSignalProcessed({
      shop,
      productId,
      processingToken: signal.processingToken,
    });

    if (!completed) {
      return {
        ...result,
        needsFollowUp: true,
      };
    }

    return result;
  } catch (error) {
    await markProductReconcileSignalFailed({
      shop,
      productId,
      processingToken: signal.processingToken,
      error,
    }).catch(() => {});
    throw error;
  }
}

export async function runIncrementalReconcile({
  shop,
  overlapMs = PRODUCT_RECONCILE_OVERLAP_MS,
  updatedSinceOverride = null,
}) {
  const store = await prisma.store.findUnique({
    where: { shopUrl: shop },
    select: {
      lastIncrementalSyncAt: true,
      lastFullSyncAt: true,
      repairRequired: true,
      activeMirrorBatchId: true,
    },
  });

  if (!store?.activeMirrorBatchId) {
    await addShopSyncJob({
      shop,
      syncType: "product",
      reason: "incremental_reconcile_missing_batch",
    }).catch(() => {});
    return { scheduledRepair: true, reason: "missing_active_mirror_batch" };
  }

  const baseline =
    normalizeTimestamp(updatedSinceOverride) ||
    normalizeTimestamp(store.lastIncrementalSyncAt) ||
    normalizeTimestamp(store.lastFullSyncAt) ||
    new Date(Date.now() - 24 * 60 * 60 * 1000);
  const updatedSince = new Date(baseline.getTime() - overlapMs);

  const session = await getSession(shop);
  const mirrorBatchId = store.activeMirrorBatchId;
  let after = null;
  let processed = 0;

  do {
    const page = await fetchUpdatedProductsPage({ session, updatedSince, after });
    for (const product of page.products) {
      const latestKnown = await getLatestProductFreshness({
        shop,
        productId: product.id,
      });

      if (
        !isIncomingProductStateFresh({
          latest: latestKnown,
          sourceUpdatedAt: product.updatedAt || null,
          sourceEventAt: new Date(),
        })
      ) {
        continue;
      }

      await applyProductSnapshot({
        shop,
        session,
        mirrorBatchId,
        product,
        sourceKind: MIRROR_SOURCE_KINDS.INCREMENTAL_RECONCILE,
        sourceUpdatedAt: product.updatedAt || null,
        sourceEventAt: new Date(),
        emitAutomaticRuleSignal: false,
      });
      processed += 1;
    }

    after = page.hasNextPage ? page.endCursor : null;
  } while (after);

  await prisma.store.update({
    where: { shopUrl: shop },
    data: {
      lastIncrementalSyncAt: new Date(),
      lastReconcileAt: new Date(),
      ...(store.repairRequired
        ? {
            repairRequired: false,
            staleReason: null,
            mirrorHealthState: "HEALTHY",
            mirrorUnsafeSince: null,
            lastSyncErrorSummary: null,
          }
        : {}),
    },
  });

  await clearKeyCaches(`${shop}:sync_details`);

  return {
    success: true,
    shop,
    processed,
    updatedSince: updatedSince.toISOString(),
  };
}

export async function maybeEscalateMirrorRepair({
  shop,
  error,
  details = {},
}) {
  await recordMirrorAnomaly({
    shop,
    severity: "high",
    type: "product_reconcile_failure",
    entityType: "store",
    entityId: shop,
    message: error.message,
    details,
  }).catch(() => {});

  await markRepairRequired({
    shop,
    reason: MIRROR_STALE_REASONS.PARTIAL_MIRROR_DETECTED,
    summary: error.message,
    details,
  }).catch(() => {});
}
