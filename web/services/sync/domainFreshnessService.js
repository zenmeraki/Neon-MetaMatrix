import { prisma } from "../../Config/database.js";
import * as domainFreshnessRepository from "../../repositories/domainFreshnessRepository.js";
import * as catalogSnapshotService from "./catalogSnapshotService.js";
import * as syncRunService from "./syncRunService.js";

/**
 * Domain freshness service.
 *
 * Responsibilities:
 * - persist domain freshness state
 * - compose freshness with Store/CatalogSnapshot fallback
 * - block trust-sensitive reads when required domains are stale
 *
 * Not responsible for:
 * - creating migrations
 * - Shopify API calls
 * - ingestion
 * - snapshot activation
 */

export const FRESHNESS_DOMAIN = {
  PRODUCT: "PRODUCT",
  COLLECTION: "COLLECTION",
  PRODUCT_TYPE: "PRODUCT_TYPE",
  INVENTORY: "INVENTORY",
  METAFIELD: "METAFIELD",
};

export const FRESHNESS_STATUS = {
  FRESH: "FRESH",
  RUNNING: "RUNNING",
  STALE: "STALE",
  REPAIR_REQUIRED: "REPAIR_REQUIRED",
  UNKNOWN: "UNKNOWN",
};

const PRODUCT_RUN_TYPE = "FULL_BASELINE";
const PRODUCT_DOMAIN = "PRODUCT";

const assertShop = (shop) => {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required");
  }
};

const assertDomain = (domain) => {
  if (!domain || typeof domain !== "string") {
    throw new Error("domain is required");
  }
};

const normalizeDomain = (domain) => String(domain).trim().toUpperCase();

const BLOCKING_STATUSES = new Set([
  FRESHNESS_STATUS.STALE,
  FRESHNESS_STATUS.REPAIR_REQUIRED,
  FRESHNESS_STATUS.UNKNOWN,
]);

const buildNotFoundError = (message, code = "NOT_FOUND") => {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = 404;
  return error;
};

const getStoreFreshnessProjection = async (shop) => {
  return prisma.store.findUnique({
    where: { shopUrl: shop },
    select: {
      shopUrl: true,
      activeMirrorBatchId: true,
      activeCollectionBatchId: true,
      isProductSyncing: true,
      isProductInitialySyning: true,
      isCollectionSyncing: true,
      isProductTypeSyncing: true,
      shopifyBulkJobCompleted: true,
      syncProgressStage: true,
      mirrorHealthState: true,
      staleReason: true,
      repairRequired: true,
      mirrorUnsafeSince: true,
      lastFullSyncAt: true,
      lastIncrementalSyncAt: true,
      lastProductSyncAt: true,
      lastProductTypeSyncAt: true,
      lastCollectionSyncAt: true,
      lastWebhookProcessedAt: true,
      lastReconcileAt: true,
      lastInventoryReconcileAt: true,
      lastCollectionReconcileAt: true,
      lastSyncErrorSummary: true,
      updatedAt: true,
    },
  });
};

const resolveStatus = ({
  running = false,
  repairRequired = false,
  lastFreshAt = null,
  staleReason = null,
}) => {
  if (repairRequired) {
    return FRESHNESS_STATUS.REPAIR_REQUIRED;
  }

  if (running) {
    return FRESHNESS_STATUS.RUNNING;
  }

  if (staleReason) {
    return FRESHNESS_STATUS.STALE;
  }

  if (lastFreshAt) {
    return FRESHNESS_STATUS.FRESH;
  }

  return FRESHNESS_STATUS.UNKNOWN;
};

const buildDomainFreshness = ({
  domain,
  status,
  lastFreshAt = null,
  source = "STORE",
  reason = null,
  details = {},
}) => {
  return {
    domain,
    status,
    lastFreshAt,
    source,
    reason,
    details,
  };
};

const toPersistedDomainShape = (row) => {
  if (!row) return null;

  return buildDomainFreshness({
    domain: row.domain,
    status: row.status,
    lastFreshAt: row.lastFreshAt || null,
    source: row.source || "DOMAIN_FRESHNESS",
    reason: row.staleReason || null,
    details: {
      sourceRunId: row.sourceRunId || null,
      catalogBatchId: row.catalogBatchId || null,
      repairRequired: row.repairRequired,
      ...(row.details && typeof row.details === "object" ? row.details : {}),
    },
  });
};

const getLatestProductSyncRun = async (shop) => {
  return syncRunService.getLatestSyncRun({
    shop,
    runType: PRODUCT_RUN_TYPE,
    domain: PRODUCT_DOMAIN,
  });
};

const buildProductFreshness = ({
  store,
  activeCatalogBatch,
  latestProductSyncRun,
}) => {
  const running =
    store.isProductSyncing === true || store.isProductInitialySyning === true;

  const lastFreshAt =
    activeCatalogBatch.activatedAt ||
    store.lastFullSyncAt ||
    store.lastProductSyncAt ||
    null;

  const status = resolveStatus({
    running,
    repairRequired: store.repairRequired,
    lastFreshAt,
    staleReason: store.staleReason,
  });

  return buildDomainFreshness({
    domain: FRESHNESS_DOMAIN.PRODUCT,
    status,
    lastFreshAt,
    source: activeCatalogBatch.source,
    reason: store.staleReason || store.lastSyncErrorSummary || null,
    details: {
      activeCatalogBatchId: activeCatalogBatch.catalogBatchId,
      activeSnapshotId: activeCatalogBatch.snapshotId,
      mirrorHealthState: store.mirrorHealthState,
      mirrorUnsafeSince: store.mirrorUnsafeSince,
      syncProgressStage: store.syncProgressStage,
      latestSyncRunId: latestProductSyncRun?.id || null,
      latestSyncRunStatus: latestProductSyncRun?.status || null,
      latestSyncRunStage: latestProductSyncRun?.stage || null,
      latestSyncRunCatalogBatchId: latestProductSyncRun?.catalogBatchId || null,
    },
  });
};

const buildCollectionFreshness = (store, activeCatalogBatch) => {
  const activeCatalogBatchId = activeCatalogBatch.catalogBatchId || null;
  const collectionBatchId = store.activeCollectionBatchId || null;
  const batchMismatch =
    collectionBatchId &&
    activeCatalogBatchId &&
    collectionBatchId !== activeCatalogBatchId;

  return buildDomainFreshness({
    domain: FRESHNESS_DOMAIN.COLLECTION,
    status: resolveStatus({
      running: store.isCollectionSyncing === true,
      lastFreshAt: store.lastCollectionReconcileAt || store.lastCollectionSyncAt,
      staleReason: batchMismatch
        ? "Collection batch does not match active product catalog batch"
        : null,
    }),
    lastFreshAt: store.lastCollectionReconcileAt || store.lastCollectionSyncAt,
    source: "STORE",
    reason: batchMismatch
      ? "Collection batch does not match active product catalog batch"
      : null,
    details: {
      activeCollectionBatchId: store.activeCollectionBatchId,
      activeCatalogBatchId,
      catalogBatchId: collectionBatchId,
      lastCollectionSyncAt: store.lastCollectionSyncAt,
      lastCollectionReconcileAt: store.lastCollectionReconcileAt,
    },
  });
};

const buildProductTypeFreshness = (store) => {
  return buildDomainFreshness({
    domain: FRESHNESS_DOMAIN.PRODUCT_TYPE,
    status: resolveStatus({
      running: store.isProductTypeSyncing === true,
      lastFreshAt: store.lastProductTypeSyncAt,
    }),
    lastFreshAt: store.lastProductTypeSyncAt,
    source: "STORE",
  });
};

const buildInventoryFreshness = (store) => {
  return buildDomainFreshness({
    domain: FRESHNESS_DOMAIN.INVENTORY,
    status: resolveStatus({
      lastFreshAt: store.lastInventoryReconcileAt,
    }),
    lastFreshAt: store.lastInventoryReconcileAt,
    source: "STORE",
  });
};

const buildMetafieldFreshness = (store) => {
  return buildDomainFreshness({
    domain: FRESHNESS_DOMAIN.METAFIELD,
    status: resolveStatus({
      lastFreshAt: store.lastFullSyncAt || store.lastProductSyncAt,
    }),
    lastFreshAt: store.lastFullSyncAt || store.lastProductSyncAt,
    source: "STORE_DERIVED",
    reason: "No dedicated metafield freshness table exists yet",
  });
};

export const getDomainFreshness = async ({ shop }) => {
  assertShop(shop);

  const [store, activeCatalogBatch, latestProductSyncRun] = await Promise.all([
    getStoreFreshnessProjection(shop),
    catalogSnapshotService.getActiveCatalogBatchId({
      shop,
      path: "domain_freshness",
    }),
    getLatestProductSyncRun(shop),
  ]);

  if (!store) {
    throw buildNotFoundError("Store not found", "STORE_NOT_FOUND");
  }

  const derivedDomains = {
    [FRESHNESS_DOMAIN.PRODUCT]: buildProductFreshness({
      store,
      activeCatalogBatch,
      latestProductSyncRun,
    }),
    [FRESHNESS_DOMAIN.COLLECTION]: buildCollectionFreshness(
      store,
      activeCatalogBatch,
    ),
    [FRESHNESS_DOMAIN.PRODUCT_TYPE]: buildProductTypeFreshness(store),
    [FRESHNESS_DOMAIN.INVENTORY]: buildInventoryFreshness(store),
    [FRESHNESS_DOMAIN.METAFIELD]: buildMetafieldFreshness(store),
  };

  const persistedRows = await domainFreshnessRepository
    .listDomainFreshnessByShop(shop)
    .catch(() => []);
  const persistedDomains = Object.fromEntries(
    persistedRows.map((row) => [row.domain, toPersistedDomainShape(row)]),
  );
  const domains = {
    ...derivedDomains,
    ...Object.fromEntries(
      Object.entries(persistedDomains).filter(([, value]) => value),
    ),
  };

  return {
    shop,
    generatedAt: new Date(),
    mirrorHealthState: store.mirrorHealthState,
    repairRequired: store.repairRequired,
    staleReason: store.staleReason,
    activeCatalogBatch,
    domains,
  };
};

export const markDomainFresh = async ({
  shop,
  domain,
  lastFreshAt = new Date(),
  source = "SYSTEM",
  sourceRunId = null,
  catalogBatchId = null,
  details = null,
}) => {
  assertShop(shop);
  assertDomain(domain);

  return domainFreshnessRepository.upsertDomainFreshness({
    shop,
    domain: normalizeDomain(domain),
    status: FRESHNESS_STATUS.FRESH,
    lastFreshAt,
    staleReason: null,
    repairRequired: false,
    source,
    sourceRunId,
    catalogBatchId,
    details,
  });
};

export const markDomainStale = async ({
  shop,
  domain,
  staleReason = "DOMAIN_STALE",
  repairRequired = false,
  source = "SYSTEM",
  sourceRunId = null,
  catalogBatchId = null,
  details = null,
}) => {
  assertShop(shop);
  assertDomain(domain);

  return domainFreshnessRepository.upsertDomainFreshness({
    shop,
    domain: normalizeDomain(domain),
    status: repairRequired
      ? FRESHNESS_STATUS.REPAIR_REQUIRED
      : FRESHNESS_STATUS.STALE,
    lastFreshAt: null,
    staleReason,
    repairRequired,
    source,
    sourceRunId,
    catalogBatchId,
    details,
  });
};

export const markDomainRunning = async ({
  shop,
  domain,
  staleReason = "DOMAIN_SYNC_RUNNING",
  source = "SYSTEM",
  sourceRunId = null,
  catalogBatchId = null,
  details = null,
}) => {
  assertShop(shop);
  assertDomain(domain);

  return domainFreshnessRepository.upsertDomainFreshness({
    shop,
    domain: normalizeDomain(domain),
    status: FRESHNESS_STATUS.RUNNING,
    staleReason,
    repairRequired: false,
    source,
    sourceRunId,
    catalogBatchId,
    details,
  });
};

export const markDomainsFresh = async ({
  shop,
  domains,
  lastFreshAt = new Date(),
  source = "SYSTEM",
  sourceRunId = null,
  catalogBatchId = null,
  details = null,
}) => {
  if (!Array.isArray(domains) || domains.length === 0) {
    throw new Error("domains must be a non-empty array");
  }

  return Promise.all(
    domains.map((domain) =>
      markDomainFresh({
        shop,
        domain,
        lastFreshAt,
        source,
        sourceRunId,
        catalogBatchId,
        details,
      }),
    ),
  );
};

export const assertDomainsFresh = async ({
  shop,
  domains,
  source = "domainFreshnessService.assertDomainsFresh",
  allowUnknown = false,
}) => {
  assertShop(shop);

  if (!Array.isArray(domains) || domains.length === 0) {
    throw new Error("domains must be a non-empty array");
  }

  const freshness = await getDomainFreshness({ shop });
  const normalizedDomains = domains.map(normalizeDomain);
  const blocked = domains
    .map((domain) => normalizeDomain(domain))
    .map((domain) => freshness.domains[domain] || {
      domain,
      status: FRESHNESS_STATUS.UNKNOWN,
      reason: "Domain freshness is not known",
    })
    .filter((domainFreshness) => {
      if (allowUnknown && domainFreshness.status === FRESHNESS_STATUS.UNKNOWN) {
        return false;
      }

      return BLOCKING_STATUSES.has(domainFreshness.status);
    });

  if (blocked.length > 0) {
    const error = new Error("Catalog domain freshness is not safe for this read");
    error.code = "CATALOG_DOMAIN_STALE";
    error.httpStatus = 409;
    error.details = {
      shop,
      source,
      blockedDomains: blocked,
    };
    throw error;
  }

  const activeCatalogBatchId = freshness.activeCatalogBatch?.catalogBatchId || null;
  const batchScopedDomains = new Set([
    FRESHNESS_DOMAIN.COLLECTION,
    FRESHNESS_DOMAIN.INVENTORY,
    FRESHNESS_DOMAIN.METAFIELD,
  ]);
  const batchMismatches = normalizedDomains
    .filter((domain) => batchScopedDomains.has(domain))
    .map((domain) => {
      const domainFreshness = freshness.domains[domain];
      const domainBatchId =
        domainFreshness?.details?.catalogBatchId ||
        domainFreshness?.details?.activeCollectionBatchId ||
        null;

      return {
        domain,
        status: domainFreshness?.status || FRESHNESS_STATUS.UNKNOWN,
        catalogBatchId: domainBatchId,
        activeCatalogBatchId,
      };
    })
    .filter((domain) => {
      if (domain.status !== FRESHNESS_STATUS.FRESH) {
        return false;
      }

      if (!activeCatalogBatchId) {
        return false;
      }

      return !domain.catalogBatchId || domain.catalogBatchId !== activeCatalogBatchId;
    });

  if (batchMismatches.length > 0) {
    const error = new Error(
      "Catalog domain batch is not aligned with the active product catalog batch",
    );
    error.code = "CATALOG_DOMAIN_BATCH_MISMATCH";
    error.httpStatus = 409;
    error.details = {
      shop,
      source,
      activeCatalogBatchId,
      mismatchedDomains: batchMismatches,
    };
    throw error;
  }

  return {
    shop,
    domains: normalizedDomains,
    freshness,
  };
};

export const getDomainFreshnessSummary = async ({ shop }) => {
  const freshness = await getDomainFreshness({ shop });
  const domainValues = Object.values(freshness.domains);
  const repairRequired = domainValues.some(
    (domain) => domain.status === FRESHNESS_STATUS.REPAIR_REQUIRED,
  );
  const running = domainValues.some(
    (domain) => domain.status === FRESHNESS_STATUS.RUNNING,
  );
  const stale = domainValues.some(
    (domain) => domain.status === FRESHNESS_STATUS.STALE,
  );
  const unknown = domainValues.some(
    (domain) => domain.status === FRESHNESS_STATUS.UNKNOWN,
  );

  return {
    shop,
    generatedAt: freshness.generatedAt,
    status:
      (repairRequired && FRESHNESS_STATUS.REPAIR_REQUIRED) ||
      (running && FRESHNESS_STATUS.RUNNING) ||
      (stale && FRESHNESS_STATUS.STALE) ||
      (unknown && FRESHNESS_STATUS.UNKNOWN) ||
      FRESHNESS_STATUS.FRESH,
    activeCatalogBatch: freshness.activeCatalogBatch,
    domains: Object.fromEntries(
      domainValues.map((domain) => [domain.domain, domain.status]),
    ),
  };
};
