import { prisma } from "../Config/database.js";

/**
 * DomainFreshness repository.
 *
 * Transitional responsibilities:
 * - expose Store-backed freshness state that exists today
 * - persist DomainFreshness rows for domain-level read safety
 *
 * No responsibilities:
 * - Shopify API calls
 * - sync orchestration
 * - API response shaping
 */

const DEFAULT_SELECT = {
  id: true,
  shop: true,
  domain: true,
  status: true,
  lastFreshAt: true,
  staleReason: true,
  repairRequired: true,
  source: true,
  sourceRunId: true,
  catalogBatchId: true,
  details: true,
  createdAt: true,
  updatedAt: true,
};

const STORE_FRESHNESS_SELECT = {
  shopUrl: true,
  activeMirrorBatchId: true,
  activeCollectionBatchId: true,
  mirrorHealthState: true,
  staleReason: true,
  repairRequired: true,
  mirrorUnsafeSince: true,
  lastFullSyncAt: true,
  lastIncrementalSyncAt: true,
  lastWebhookProcessedAt: true,
  lastReconcileAt: true,
  lastInventoryReconcileAt: true,
  lastCollectionReconcileAt: true,
  lastProductSyncAt: true,
  lastCollectionSyncAt: true,
  lastProductTypeSyncAt: true,
  isProductSyncing: true,
  isProductInitialySyning: true,
  isCollectionSyncing: true,
  isProductTypeSyncing: true,
  syncProgressStage: true,
  shopifyBulkJobCompleted: true,
  lastSyncErrorSummary: true,
  updatedAt: true,
};

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

const assertData = (data) => {
  if (!data || typeof data !== "object") {
    throw new Error("data is required");
  }
};

const buildSelect = (select) => select || DEFAULT_SELECT;

/**
 * Current compatibility projection from Store.
 */
export const getStoreFreshnessState = async (shop, options = {}) => {
  assertShop(shop);

  return prisma.store.findUnique({
    where: { shopUrl: shop },
    select: options.select || STORE_FRESHNESS_SELECT,
  });
};

/**
 * Current compatibility update for Store-level freshness flags.
 */
export const updateStoreFreshnessState = async (shop, data, options = {}) => {
  assertShop(shop);
  assertData(data);

  return prisma.store.update({
    where: { shopUrl: shop },
    data,
    select: options.select || STORE_FRESHNESS_SELECT,
  });
};

/**
 * DomainFreshness lookup.
 */
export const findDomainFreshness = async (shop, domain, options = {}) => {
  assertShop(shop);
  assertDomain(domain);

  return prisma.domainFreshness.findUnique({
    where: {
      shop_domain: {
        shop,
        domain,
      },
    },
    select: buildSelect(options.select),
  });
};

/**
 * DomainFreshness list.
 */
export const listDomainFreshnessByShop = async (shop, options = {}) => {
  assertShop(shop);

  return prisma.domainFreshness.findMany({
    where: { shop },
    orderBy: [{ domain: "asc" }],
    select: buildSelect(options.select),
  });
};

/**
 * DomainFreshness create.
 */
export const createDomainFreshness = async (data, options = {}) => {
  assertData(data);
  assertShop(data.shop);
  assertDomain(data.domain);

  return prisma.domainFreshness.create({
    data,
    select: buildSelect(options.select),
  });
};

export const upsertDomainFreshness = async (data, options = {}) => {
  assertData(data);
  assertShop(data.shop);
  assertDomain(data.domain);

  return prisma.domainFreshness.upsert({
    where: {
      shop_domain: {
        shop: data.shop,
        domain: data.domain,
      },
    },
    create: data,
    update: {
      ...(data.status ? { status: data.status } : {}),
      ...(data.lastFreshAt !== undefined ? { lastFreshAt: data.lastFreshAt } : {}),
      ...(data.staleReason !== undefined ? { staleReason: data.staleReason } : {}),
      ...(data.repairRequired !== undefined
        ? { repairRequired: data.repairRequired }
        : {}),
      ...(data.source !== undefined ? { source: data.source } : {}),
      ...(data.sourceRunId !== undefined ? { sourceRunId: data.sourceRunId } : {}),
      ...(data.catalogBatchId !== undefined
        ? { catalogBatchId: data.catalogBatchId }
        : {}),
      ...(data.details !== undefined ? { details: data.details } : {}),
    },
    select: buildSelect(options.select),
  });
};

/**
 * DomainFreshness update by id.
 */
export const updateDomainFreshness = async (id, data, options = {}) => {
  if (!id || typeof id !== "string") {
    throw new Error("domainFreshness id is required");
  }

  assertData(data);

  return prisma.domainFreshness.update({
    where: { id },
    data,
    select: buildSelect(options.select),
  });
};

export const deleteDomainFreshnessByShop = async (shop) => {
  assertShop(shop);

  return prisma.domainFreshness.deleteMany({
    where: { shop },
  });
};
