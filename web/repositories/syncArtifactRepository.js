import { prisma } from "../Config/database.js";

/**
 * SyncArtifact repository.
 *
 * Responsibilities:
 * - persist artifact metadata tied to SyncRun
 * - retrieve latest artifact(s) for a sync run or shop
 * - update artifact metadata as processing becomes richer
 *
 * No responsibilities:
 * - downloading files
 * - computing checksums
 * - Shopify API calls
 * - ingestion orchestration
 */

const DEFAULT_SELECT = {
  id: true,
  syncRunId: true,
  shop: true,
  artifactType: true,
  storageUrl: true,
  sourceUrl: true,
  checksum: true,
  rowCount: true,
  contentType: true,
  pipelineVersion: true,
  schemaVersion: true,
  createdAt: true,
};

const assertId = (id, fieldName = "id") => {
  if (!id || typeof id !== "string") {
    throw new Error(`${fieldName} is required`);
  }
};

const assertShop = (shop) => {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required");
  }
};

const assertArtifactType = (artifactType) => {
  if (!artifactType || typeof artifactType !== "string") {
    throw new Error("artifactType is required");
  }
};

const buildSelect = (select) => select || DEFAULT_SELECT;

/**
 * Create a sync artifact row.
 */
export const createSyncArtifact = async (data, options = {}) => {
  if (!data || typeof data !== "object") {
    throw new Error("data is required");
  }

  assertId(data.syncRunId, "syncRunId");
  assertShop(data.shop);
  assertArtifactType(data.artifactType);

  return prisma.syncArtifact.create({
    data,
    select: buildSelect(options.select),
  });
};

/**
 * Create many sync artifact rows.
 *
 * Use for batch metadata persistence after multiple artifact outputs
 * are generated for the same sync run.
 */
export const createManySyncArtifacts = async (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("rows must be a non-empty array");
  }

  for (const row of rows) {
    assertId(row?.syncRunId, "syncRunId");
    assertShop(row?.shop);
    assertArtifactType(row?.artifactType);
  }

  return prisma.syncArtifact.createMany({
    data: rows,
    skipDuplicates: false,
  });
};

/**
 * Find artifact by id.
 */
export const findSyncArtifactById = async (id, options = {}) => {
  assertId(id, "syncArtifact id");

  return prisma.syncArtifact.findUnique({
    where: { id },
    select: buildSelect(options.select),
  });
};

/**
 * Update artifact metadata by id.
 */
export const updateSyncArtifact = async (id, data, options = {}) => {
  assertId(id, "syncArtifact id");

  if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
    throw new Error("update data is required");
  }

  return prisma.syncArtifact.update({
    where: { id },
    data,
    select: buildSelect(options.select),
  });
};

/**
 * Find all artifacts for a sync run.
 */
export const listArtifactsBySyncRunId = async (
  syncRunId,
  options = {},
) => {
  assertId(syncRunId, "syncRunId");

  const take =
    typeof options.take === "number" && options.take > 0
      ? Math.min(options.take, 100)
      : undefined;

  return prisma.syncArtifact.findMany({
    where: { syncRunId },
    orderBy: [{ createdAt: "asc" }],
    ...(take ? { take } : {}),
    select: buildSelect(options.select),
  });
};

/**
 * Find latest artifact for a sync run.
 *
 * Optional filters:
 * - artifactType
 */
export const findLatestArtifactBySyncRunId = async (
  syncRunId,
  filters = {},
  options = {},
) => {
  assertId(syncRunId, "syncRunId");

  return prisma.syncArtifact.findFirst({
    where: {
      syncRunId,
      ...(filters.artifactType ? { artifactType: filters.artifactType } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: buildSelect(options.select),
  });
};

/**
 * Find latest artifact for a shop.
 *
 * Optional filters:
 * - artifactType
 */
export const findLatestArtifactByShop = async (
  shop,
  filters = {},
  options = {},
) => {
  assertShop(shop);

  return prisma.syncArtifact.findFirst({
    where: {
      shop,
      ...(filters.artifactType ? { artifactType: filters.artifactType } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: buildSelect(options.select),
  });
};

/**
 * List recent artifacts for a shop.
 */
export const listRecentArtifactsByShop = async (
  shop,
  filters = {},
  options = {},
) => {
  assertShop(shop);

  const take =
    typeof options.take === "number" && options.take > 0
      ? Math.min(options.take, 100)
      : 20;

  return prisma.syncArtifact.findMany({
    where: {
      shop,
      ...(filters.artifactType ? { artifactType: filters.artifactType } : {}),
      ...(filters.syncRunId ? { syncRunId: filters.syncRunId } : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    take,
    select: buildSelect(options.select),
  });
};

/**
 * Delete artifacts for a sync run.
 *
 * Use carefully. In production flows, retaining artifacts is usually preferable.
 */
export const deleteArtifactsBySyncRunId = async (syncRunId) => {
  assertId(syncRunId, "syncRunId");

  return prisma.syncArtifact.deleteMany({
    where: { syncRunId },
  });
};

/**
 * Upsert-like helper for a single artifact identity inside a sync run.
 *
 * Practical use:
 * - you create a BULK_JSONL artifact row early with sourceUrl
 * - later enrich it with rowCount/checksum/storageUrl
 *
 * Identity rule here:
 * - one syncRunId + artifactType + sourceUrl combination
 *
 * This is implemented as "find then update/create" because Prisma schema
 * may not yet have a composite unique on those columns.
 */
export const upsertArtifactByRunTypeAndSourceUrl = async (
  {
    syncRunId,
    shop,
    artifactType,
    sourceUrl,
    storageUrl = null,
    checksum = null,
    rowCount = null,
    contentType = null,
    pipelineVersion = null,
    schemaVersion = null,
  },
  options = {},
) => {
  assertId(syncRunId, "syncRunId");
  assertShop(shop);
  assertArtifactType(artifactType);

  const existing = await prisma.syncArtifact.findFirst({
    where: {
      syncRunId,
      artifactType,
      sourceUrl: sourceUrl || null,
    },
    select: {
      id: true,
    },
  });

  if (existing?.id) {
    return prisma.syncArtifact.update({
      where: { id: existing.id },
      data: {
        ...(sourceUrl !== undefined ? { sourceUrl } : {}),
        ...(storageUrl !== undefined ? { storageUrl } : {}),
        ...(checksum !== undefined ? { checksum } : {}),
        ...(rowCount !== undefined ? { rowCount } : {}),
        ...(contentType !== undefined ? { contentType } : {}),
        ...(pipelineVersion !== undefined ? { pipelineVersion } : {}),
        ...(schemaVersion !== undefined ? { schemaVersion } : {}),
      },
      select: buildSelect(options.select),
    });
  }

  return prisma.syncArtifact.create({
    data: {
      syncRunId,
      shop,
      artifactType,
      sourceUrl,
      storageUrl,
      checksum,
      rowCount,
      contentType,
      pipelineVersion,
      schemaVersion,
    },
    select: buildSelect(options.select),
  });
};
