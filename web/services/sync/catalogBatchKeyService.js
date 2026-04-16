import { getActiveBatchIds } from "./catalogSnapshotService.js";

export const CATALOG_BATCH_FIELD = {
  CANONICAL: "catalogBatchId",
  PRODUCT_MIRROR: "catalogBatchId",
  VARIANT_MIRROR: "catalogBatchId",
  COLLECTION_MIRROR: "catalogBatchId",
  COLLECTION_MEMBERSHIP: "catalogBatchId",
  INVENTORY: "catalogBatchId",
  PRODUCT_METAFIELD: "catalogBatchId",
  VARIANT_METAFIELD: "catalogBatchId",
};

export const getBatchScopedWhere = ({ domain, catalogBatchId }) => {
  const field = CATALOG_BATCH_FIELD[domain];

  if (!field) {
    throw new Error(`Unsupported catalog batch domain: ${domain}`);
  }

  if (!catalogBatchId || typeof catalogBatchId !== "string") {
    throw new Error("catalogBatchId is required");
  }

  return {
    [field]: catalogBatchId,
  };
};

export const requireActiveCatalogBatchId = async ({
  shop,
  path = "batch_resolution",
}) => {
  const activeBatch = await getActiveBatchIds({
    shop,
    path,
  });

  if (activeBatch.catalogBatchId) {
    return activeBatch;
  }

  const error = new Error("No active catalog batch is available");
  error.code = "ACTIVE_CATALOG_BATCH_REQUIRED";
  error.httpStatus = 409;
  error.details = {
    shop,
    reason: activeBatch.reason || null,
  };
  throw error;
};
