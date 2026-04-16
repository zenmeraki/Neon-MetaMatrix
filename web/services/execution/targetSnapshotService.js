import * as targetSnapshotRepository from "../../repositories/targetSnapshotRepository.js";

/**
 * Target snapshot service.
 *
 * Responsibilities:
 * - create and activate immutable target sets for execution
 * - replace item lists transactionally through the repository
 *
 * Not responsible for:
 * - compiling filters
 * - executing Shopify mutations
 */

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

const assertOwner = ({ ownerType, ownerId }) => {
  if (!ownerType) throw new Error("ownerType is required");
  if (!ownerId) throw new Error("ownerId is required");
};

const normalizeItems = ({
  targetSnapshotSetId,
  shop,
  catalogBatchId,
  items,
}) => {
  if (!Array.isArray(items)) {
    throw new Error("items must be an array");
  }

  return items.map((item) => {
    const productId = typeof item === "string" ? item : item.productId;

    if (!productId) {
      throw new Error("target item productId is required");
    }

    return {
      targetSnapshotSetId,
      shop,
      targetKey:
        (typeof item === "string" ? null : item.targetKey) ||
        (typeof item === "string" || !item.variantId
          ? `product:${productId}`
          : `variant:${item.variantId}`),
      productId,
      variantId: typeof item === "string" ? null : item.variantId || null,
      catalogBatchId:
        (typeof item === "string" ? catalogBatchId : item.catalogBatchId) ||
        catalogBatchId ||
        null,
      batchSequenceNumber:
        typeof item === "string" ? null : item.batchSequenceNumber ?? null,
      reason: typeof item === "string" ? null : item.reason || null,
    };
  });
};

export const createTargetSnapshot = async ({
  shop,
  ownerType,
  ownerId,
  catalogBatchId = null,
  mirrorBatchId = null,
  sourceType = null,
  reason = null,
  targetLevel = "PRODUCT",
  filterVersion = null,
  canonicalFilterKey = null,
  compiledWhereHash = null,
  rulesHash = null,
  ruleEngineVersion = null,
  filterAnchorTime = null,
  items = [],
  client = null,
}) => {
  assertShop(shop);
  assertOwner({ ownerType, ownerId });

  const snapshotSet = await targetSnapshotRepository.createTargetSnapshotSet({
    shop,
    ownerType,
    ownerId,
    catalogBatchId,
    mirrorBatchId,
    sourceType,
    reason,
    targetLevel,
    filterVersion,
    canonicalFilterKey,
    compiledWhereHash,
    rulesHash,
    ruleEngineVersion,
    filterAnchorTime,
    status: SNAPSHOT_STATUS.BUILDING,
    targetCount: 0,
  }, {
    client,
  });

  const rows = normalizeItems({
    targetSnapshotSetId: snapshotSet.id,
    shop,
    catalogBatchId,
    items,
  });

  return targetSnapshotRepository.replaceTargetSnapshotItems({
    targetSnapshotSetId: snapshotSet.id,
    rows,
    client,
  });
};

export const createBuildingTargetSnapshotSet = async ({
  shop,
  ownerType,
  ownerId,
  catalogBatchId = null,
  mirrorBatchId = null,
  sourceType = null,
  reason = null,
  targetLevel = "PRODUCT",
  filterVersion = null,
  canonicalFilterKey = null,
  compiledWhereHash = null,
  rulesHash = null,
  ruleEngineVersion = null,
  filterAnchorTime = null,
  client = null,
}) => {
  assertShop(shop);
  assertOwner({ ownerType, ownerId });

  return targetSnapshotRepository.createTargetSnapshotSet({
    shop,
    ownerType,
    ownerId,
    catalogBatchId,
    mirrorBatchId,
    sourceType,
    reason,
    targetLevel,
    filterVersion,
    canonicalFilterKey,
    compiledWhereHash,
    rulesHash,
    ruleEngineVersion,
    filterAnchorTime,
    status: SNAPSHOT_STATUS.BUILDING,
    targetCount: 0,
  }, {
    client,
  });
};

export const appendTargetSnapshotItems = async ({
  targetSnapshotSetId,
  shop,
  catalogBatchId = null,
  items = [],
  client = null,
}) => {
  if (!targetSnapshotSetId || typeof targetSnapshotSetId !== "string") {
    throw new Error("targetSnapshotSetId is required");
  }

  assertShop(shop);

  const rows = normalizeItems({
    targetSnapshotSetId,
    shop,
    catalogBatchId,
    items,
  });

  if (rows.length === 0) {
    return { count: 0 };
  }

  return targetSnapshotRepository.createManyTargetSnapshotItems(rows, { client });
};

export const activateTargetSnapshot = async (
  targetSnapshotSetId,
  { targetCount = null, client = null } = {},
) => {
  if (!targetSnapshotSetId || typeof targetSnapshotSetId !== "string") {
    throw new Error("targetSnapshotSetId is required");
  }

  return targetSnapshotRepository.updateTargetSnapshotSet(targetSnapshotSetId, {
    status: SNAPSHOT_STATUS.ACTIVE,
    activatedAt: new Date(),
    ...(typeof targetCount === "number" ? { targetCount } : {}),
  }, { client });
};

export const markTargetSnapshotFailed = async (
  targetSnapshotSetId,
  reason = null,
  { client = null } = {},
) => {
  if (!targetSnapshotSetId || typeof targetSnapshotSetId !== "string") {
    throw new Error("targetSnapshotSetId is required");
  }

  return targetSnapshotRepository.updateTargetSnapshotSet(targetSnapshotSetId, {
    status: SNAPSHOT_STATUS.FAILED,
    reason,
  }, { client });
};

export const getLatestTargetSnapshot = async ({
  shop,
  ownerType,
  ownerId,
  status = null,
}) => {
  assertShop(shop);
  assertOwner({ ownerType, ownerId });

  return targetSnapshotRepository.findLatestTargetSnapshotSet({
    shop,
    ownerType,
    ownerId,
    status,
  });
};

export const getTargetSnapshotForExecution = async ({
  targetSnapshotSetId,
  shop,
  ownerType,
  ownerId,
  status = "ACTIVE",
}) => {
  assertShop(shop);
  assertOwner({ ownerType, ownerId });

  return targetSnapshotRepository.findTargetSnapshotSetForExecution({
    id: targetSnapshotSetId,
    shop,
    ownerType,
    ownerId,
    status,
  });
};

export const listTargetSnapshotItems = async ({
  targetSnapshotSetId,
  take = 100,
  cursorProductId = null,
  cursorTargetKey = null,
}) => {
  return targetSnapshotRepository.listTargetSnapshotItems({
    targetSnapshotSetId,
    take,
    cursorProductId,
    cursorTargetKey,
  });
};
