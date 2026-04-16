import { prisma } from "../Config/database.js";

/**
 * CatalogSnapshot repository.
 *
 * Responsibilities:
 * - manage snapshot lifecycle (BUILDING -> ACTIVE -> SUPERSEDED)
 * - enforce single ACTIVE snapshot per shop
 * - provide active snapshot lookup for read paths
 *
 * No responsibilities:
 * - no sync orchestration
 * - no Shopify calls
 * - no ingestion logic
 */

const DEFAULT_SELECT = {
  id: true,
  shop: true,
  catalogBatchId: true,
  syncRunId: true,
  schemaVersion: true,
  status: true,
  reason: true,
  expectedProductCount: true,
  actualProductCount: true,
  expectedVariantCount: true,
  actualVariantCount: true,
  expectedCollectionMembershipCount: true,
  actualCollectionMembershipCount: true,
  expectedInventoryLevelCount: true,
  actualInventoryLevelCount: true,
  createdAt: true,
  activatedAt: true,
  supersededAt: true,
  updatedAt: true,
};

const SNAPSHOT_STATUS = {
  BUILDING: "BUILDING",
  ACTIVE: "ACTIVE",
  SUPERSEDED: "SUPERSEDED",
  FAILED: "FAILED",
};

const assertShop = (shop) => {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required");
  }
};

const assertId = (id, fieldName = "id") => {
  if (!id || typeof id !== "string") {
    throw new Error(`${fieldName} is required`);
  }
};

const assertBatchId = (catalogBatchId) => {
  if (!catalogBatchId || typeof catalogBatchId !== "string") {
    throw new Error("catalogBatchId is required");
  }
};

const buildSelect = (select) => select || DEFAULT_SELECT;

/**
 * Create a new BUILDING snapshot.
 *
 * Called when a new sync starts producing a fresh catalog batch.
 */
export const createBuildingSnapshot = async (
  { shop, catalogBatchId, syncRunId = null, schemaVersion = "catalog-snapshot-v1", reason = null },
  options = {},
) => {
  assertShop(shop);
  assertBatchId(catalogBatchId);

  return prisma.catalogSnapshot.create({
    data: {
      shop,
      catalogBatchId,
      syncRunId,
      schemaVersion,
      status: SNAPSHOT_STATUS.BUILDING,
      reason,
    },
    select: buildSelect(options.select),
  });
};

/**
 * Find snapshot by id.
 */
export const findSnapshotById = async (id, options = {}) => {
  assertId(id, "catalogSnapshot id");

  return prisma.catalogSnapshot.findUnique({
    where: { id },
    select: buildSelect(options.select),
  });
};

/**
 * Find snapshot by batch id.
 */
export const findSnapshotByBatchId = async (
  shop,
  catalogBatchId,
  options = {},
) => {
  assertShop(shop);
  assertBatchId(catalogBatchId);

  return prisma.catalogSnapshot.findFirst({
    where: {
      shop,
      catalogBatchId,
    },
    orderBy: { createdAt: "desc" },
    select: buildSelect(options.select),
  });
};

/**
 * Get the ACTIVE snapshot for a shop.
 *
 * This becomes your future single source of truth for read paths.
 */
export const findActiveCatalogSnapshot = async (shop, options = {}) => {
  assertShop(shop);

  return prisma.catalogSnapshot.findFirst({
    where: {
      shop,
      status: SNAPSHOT_STATUS.ACTIVE,
    },
    orderBy: { activatedAt: "desc" },
    select: buildSelect(options.select),
  });
};

/**
 * Get the active catalog pointer row for a shop.
 */
export const findActiveCatalogSnapshotPointer = async (shop, options = {}) => {
  assertShop(shop);

  return prisma.activeCatalogSnapshot.findUnique({
    where: { shop },
    select: options.select || undefined,
  });
};

/**
 * Get per-shop catalog snapshot read cutover flags.
 */
export const findCatalogSnapshotFlagsByShop = async (shop) => {
  assertShop(shop);

  return prisma.store.findUnique({
    where: { shopUrl: shop },
    select: {
      catalogSnapshotReadEnabled: true,
      catalogSnapshotExecutionEnabled: true,
      catalogSnapshotSchedulerEnabled: true,
      activeMirrorBatchId: true,
    },
  });
};

/**
 * Get the latest snapshot regardless of status.
 */
export const findLatestSnapshot = async (shop, options = {}) => {
  assertShop(shop);

  return prisma.catalogSnapshot.findFirst({
    where: {
      shop,
      ...(options.status ? { status: options.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: buildSelect(options.select),
  });
};

/**
 * Supersede all ACTIVE snapshots for a shop.
 *
 * This ensures we never have more than one ACTIVE snapshot.
 */
export const supersedeActiveSnapshots = async (
  shop,
  { excludeSnapshotId = null } = {},
) => {
  assertShop(shop);

  const where = {
    shop,
    status: SNAPSHOT_STATUS.ACTIVE,
    ...(excludeSnapshotId
      ? {
          NOT: {
            id: excludeSnapshotId,
          },
        }
      : {}),
  };

  return prisma.catalogSnapshot.updateMany({
    where,
    data: {
      status: SNAPSHOT_STATUS.SUPERSEDED,
      supersededAt: new Date(),
    },
  });
};

/**
 * Activate a snapshot.
 *
 * This is the critical operation:
 * - ensures only one ACTIVE snapshot exists
 * - sets activatedAt timestamp
 *
 * Uses a transaction for safety.
 */
export const activateCatalogSnapshot = async (
  id,
  { shop, consistency = null } = {},
  options = {},
) => {
  assertId(id, "catalogSnapshot id");

  return prisma.$transaction(async (tx) => {
    const snapshot = await tx.catalogSnapshot.findUnique({
      where: { id },
      select: {
        id: true,
        shop: true,
        status: true,
        reason: true,
        catalogBatchId: true,
        syncRunId: true,
        schemaVersion: true,
      },
    });

    if (!snapshot) {
      throw new Error("CatalogSnapshot not found");
    }

    const resolvedShop = shop || snapshot.shop;
    const lockRows = await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`catalog-snapshot:${resolvedShop}`}))
    `;
    void lockRows;

    await tx.catalogSnapshot.updateMany({
      where: {
        shop: resolvedShop,
        status: SNAPSHOT_STATUS.ACTIVE,
        NOT: { id },
      },
      data: {
        status: SNAPSHOT_STATUS.SUPERSEDED,
        supersededAt: new Date(),
      },
    });

    const activated = await tx.catalogSnapshot.update({
      where: { id },
      data: {
        status: SNAPSHOT_STATUS.ACTIVE,
        activatedAt: new Date(),
        reason: consistency?.reason ?? snapshot.reason ?? null,
        expectedProductCount: consistency?.expectedProductCount ?? null,
        actualProductCount: consistency?.actualProductCount ?? null,
        expectedVariantCount: consistency?.expectedVariantCount ?? null,
        actualVariantCount: consistency?.actualVariantCount ?? null,
        expectedCollectionMembershipCount:
          consistency?.expectedCollectionMembershipCount ?? null,
        actualCollectionMembershipCount:
          consistency?.actualCollectionMembershipCount ?? null,
        expectedInventoryLevelCount:
          consistency?.expectedInventoryLevelCount ?? null,
        actualInventoryLevelCount:
          consistency?.actualInventoryLevelCount ?? null,
      },
      select: buildSelect(options.select),
    });

    await tx.activeCatalogSnapshot.upsert({
      where: { shop: resolvedShop },
      create: {
        shop: resolvedShop,
        catalogBatchId: snapshot.catalogBatchId,
        snapshotId: snapshot.id,
        isConsistent: Boolean(consistency?.isConsistent),
        consistencyCheckedAt: consistency ? new Date() : null,
        reason: consistency?.reason ?? null,
        activatedAt: new Date(),
      },
      update: {
        catalogBatchId: snapshot.catalogBatchId,
        snapshotId: snapshot.id,
        isConsistent: Boolean(consistency?.isConsistent),
        consistencyCheckedAt: consistency ? new Date() : null,
        reason: consistency?.reason ?? null,
        activatedAt: new Date(),
      },
    });

    await tx.store.updateMany({
      where: { shopUrl: resolvedShop },
      data: {
        activeMirrorBatchId: snapshot.catalogBatchId,
      },
    });

    return activated;
  });
};

/**
 * Mark a snapshot as FAILED.
 */
export const markSnapshotFailed = async (
  id,
  { reason = null } = {},
  options = {},
) => {
  assertId(id, "catalogSnapshot id");

  return prisma.catalogSnapshot.update({
    where: { id },
    data: {
      status: SNAPSHOT_STATUS.FAILED,
      reason,
    },
    select: buildSelect(options.select),
  });
};

/**
 * Delete snapshots by batch (safe cleanup helper).
 *
 * Use carefully. Prefer superseding instead of deleting in production flows.
 */
export const deleteSnapshotsByBatch = async (shop, catalogBatchId) => {
  assertShop(shop);
  assertBatchId(catalogBatchId);

  return prisma.catalogSnapshot.deleteMany({
    where: {
      shop,
      catalogBatchId,
    },
  });
};

/**
 * List snapshots for a shop.
 */
export const listSnapshotsByShop = async (
  shop,
  { status, take = 20 } = {},
  options = {},
) => {
  assertShop(shop);

  const safeTake =
    typeof take === "number" && take > 0 ? Math.min(take, 100) : 20;

  return prisma.catalogSnapshot.findMany({
    where: {
      shop,
      ...(status ? { status } : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    take: safeTake,
    select: buildSelect(options.select),
  });
};
