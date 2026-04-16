import { prisma } from "../Config/database.js";

/**
 * TargetSnapshot repository.
 *
 * Responsibilities:
 * - Prisma access for TargetSnapshotSet and TargetSnapshotItem
 * - no mutation execution
 * - no Shopify API calls
 */

const SET_SELECT = {
  id: true,
  shop: true,
  ownerType: true,
  ownerId: true,
  catalogBatchId: true,
  mirrorBatchId: true,
  sourceType: true,
  status: true,
  targetCount: true,
  targetLevel: true,
  filterVersion: true,
  canonicalFilterKey: true,
  compiledWhereHash: true,
  rulesHash: true,
  ruleEngineVersion: true,
  filterAnchorTime: true,
  reason: true,
  activatedAt: true,
  createdAt: true,
  updatedAt: true,
};

const ITEM_SELECT = {
  id: true,
  targetSnapshotSetId: true,
  shop: true,
  targetKey: true,
  productId: true,
  variantId: true,
  catalogBatchId: true,
  batchSequenceNumber: true,
  reason: true,
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

const assertData = (data) => {
  if (!data || typeof data !== "object") {
    throw new Error("data is required");
  }
};

const buildSelect = (select, fallback) => select || fallback;
const getClient = (options = {}) => options.client || prisma;

export const createTargetSnapshotSet = async (data, options = {}) => {
  assertData(data);
  assertShop(data.shop);

  if (!data.ownerType) throw new Error("ownerType is required");
  if (!data.ownerId) throw new Error("ownerId is required");

  const client = getClient(options);

  return client.targetSnapshotSet.create({
    data,
    select: buildSelect(options.select, SET_SELECT),
  });
};

export const updateTargetSnapshotSet = async (id, data, options = {}) => {
  assertId(id, "targetSnapshotSet id");
  assertData(data);

  const client = getClient(options);

  return client.targetSnapshotSet.update({
    where: { id },
    data,
    select: buildSelect(options.select, SET_SELECT),
  });
};

export const findTargetSnapshotSetById = async (id, options = {}) => {
  assertId(id, "targetSnapshotSet id");

  const client = getClient(options);

  return client.targetSnapshotSet.findUnique({
    where: { id },
    select: buildSelect(options.select, SET_SELECT),
  });
};

export const findLatestTargetSnapshotSet = async (
  { shop, ownerType, ownerId, status = null },
  options = {},
) => {
  assertShop(shop);

  if (!ownerType) throw new Error("ownerType is required");
  if (!ownerId) throw new Error("ownerId is required");

  const client = getClient(options);

  return client.targetSnapshotSet.findFirst({
    where: {
      shop,
      ownerType,
      ownerId,
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: buildSelect(options.select, SET_SELECT),
  });
};

export const findTargetSnapshotSetForExecution = async (
  { id, shop, ownerType, ownerId, status = "ACTIVE" },
  options = {},
) => {
  assertId(id, "targetSnapshotSet id");
  assertShop(shop);

  const client = getClient(options);

  return client.targetSnapshotSet.findFirst({
    where: {
      id,
      shop,
      ownerType,
      ownerId,
      ...(status ? { status } : {}),
    },
    select: buildSelect(options.select, SET_SELECT),
  });
};

export const listTargetSnapshotItems = async (
  { targetSnapshotSetId, take = 100, cursorProductId = null, cursorTargetKey = null },
  options = {},
) => {
  assertId(targetSnapshotSetId, "targetSnapshotSetId");

  const safeTake =
    typeof take === "number" && take > 0 ? Math.min(take, 1000) : 100;

  const client = getClient(options);

  return client.targetSnapshotItem.findMany({
    where: {
      targetSnapshotSetId,
      ...(cursorTargetKey ? { targetKey: { gt: cursorTargetKey } } : {}),
      ...(cursorProductId ? { productId: { gt: cursorProductId } } : {}),
    },
    orderBy: [{ targetKey: "asc" }],
    take: safeTake,
    select: buildSelect(options.select, ITEM_SELECT),
  });
};

export const createManyTargetSnapshotItems = async (rows, options = {}) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("rows must be a non-empty array");
  }

  for (const row of rows) {
    assertId(row?.targetSnapshotSetId, "targetSnapshotSetId");
    assertShop(row?.shop);
    assertId(row?.productId, "productId");
    assertId(row?.targetKey, "targetKey");
  }

  const client = getClient(options);

  return client.targetSnapshotItem.createMany({
    data: rows,
    skipDuplicates: true,
  });
};

export const replaceTargetSnapshotItems = async ({
  targetSnapshotSetId,
  rows,
  client = prisma,
}) => {
  assertId(targetSnapshotSetId, "targetSnapshotSetId");

  if (!Array.isArray(rows)) {
    throw new Error("rows must be an array");
  }

  const run = async (tx) => {
    await tx.targetSnapshotItem.deleteMany({
      where: { targetSnapshotSetId },
    });

    if (rows.length > 0) {
      await tx.targetSnapshotItem.createMany({
        data: rows,
        skipDuplicates: true,
      });
    }

    return tx.targetSnapshotSet.update({
      where: { id: targetSnapshotSetId },
      data: {
        targetCount: rows.length,
        updatedAt: new Date(),
      },
      select: SET_SELECT,
    });
  };

  return client === prisma ? prisma.$transaction(run) : run(client);
};

export const deleteTargetSnapshotSet = async (id, options = {}) => {
  assertId(id, "targetSnapshotSet id");

  const client = getClient(options);

  return client.targetSnapshotSet.delete({
    where: { id },
  });
};
