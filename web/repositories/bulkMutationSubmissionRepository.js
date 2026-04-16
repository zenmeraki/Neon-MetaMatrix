import { prisma } from "../Config/database.js";

/**
 * BulkMutationSubmission repository.
 *
 * Prisma-only boundary for bulk mutation submission metadata.
 */

const DEFAULT_SELECT = {
  id: true,
  shop: true,
  syncRunId: true,
  editHistoryId: true,
  targetSnapshotSetId: true,
  bulkOperationId: true,
  mutationType: true,
  status: true,
  batchId: true,
  inputArtifactSha256: true,
  inputRowHash: true,
  submittedAt: true,
  completedAt: true,
  rowCount: true,
  failureCode: true,
  failureMessage: true,
  failureCategory: true,
  failureStage: true,
  retryable: true,
  createdAt: true,
  updatedAt: true,
};

const assertId = (id, fieldName = "id") => {
  if (!id || typeof id !== "string" || id.trim() === "") {
    throw new Error(`${fieldName} is required`);
  }
};

const assertShop = (shop) => {
  if (!shop || typeof shop !== "string" || shop.trim() === "") {
    throw new Error("shop is required");
  }
  if (shop !== shop.trim() || !/^[a-z0-9][a-z0-9.-]*$/i.test(shop)) {
    throw new Error("shop format is invalid");
  }
};

const assertData = (data) => {
  if (!data || typeof data !== "object") {
    throw new Error("data is required");
  }
};

const buildSelect = (select) => select || DEFAULT_SELECT;
const getClient = (options = {}) => options.tx || prisma;

export const createBulkMutationSubmission = async (data, options = {}) => {
  assertData(data);
  assertShop(data.shop);

  if (!data.mutationType) {
    throw new Error("mutationType is required");
  }

  return getClient(options).bulkMutationSubmission.create({
    data,
    select: buildSelect(options.select),
  });
};

export const updateBulkMutationSubmission = async (id, data, options = {}) => {
  assertId(id, "bulkMutationSubmission id");
  assertData(data);

  return getClient(options).bulkMutationSubmission.update({
    where: { id },
    data,
    select: buildSelect(options.select),
  });
};

export const compareAndSetBulkMutationSubmissionStatus = async ({
  id,
  currentStatus,
  data,
}, options = {}) => {
  assertId(id, "bulkMutationSubmission id");
  assertId(currentStatus, "currentStatus");
  assertData(data);

  return getClient(options).bulkMutationSubmission.updateMany({
    where: {
      id,
      status: currentStatus,
    },
    data,
  });
};

export const findBulkMutationSubmissionById = async (id, options = {}) => {
  assertId(id, "bulkMutationSubmission id");

  return getClient(options).bulkMutationSubmission.findUnique({
    where: { id },
    select: buildSelect(options.select),
  });
};

export const findBulkMutationSubmissionByOperationId = async (
  { bulkOperationId, shop },
  options = {},
) => {
  assertId(bulkOperationId, "bulkOperationId");
  assertShop(shop);

  return getClient(options).bulkMutationSubmission.findFirst({
    where: { bulkOperationId, shop },
    orderBy: { createdAt: "desc" },
    select: buildSelect(options.select),
  });
};

export const findBulkMutationSubmissionByInputRowHash = async (
  { shop, mutationType, inputRowHash },
  options = {},
) => {
  assertShop(shop);
  assertId(mutationType, "mutationType");
  assertId(inputRowHash, "inputRowHash");

  return getClient(options).bulkMutationSubmission.findFirst({
    where: { shop, mutationType, inputRowHash },
    orderBy: { createdAt: "desc" },
    select: buildSelect(options.select),
  });
};

export const listRecentBulkMutationSubmissions = async (
  { shop, status = null, mutationType = null, take = 20 },
  options = {},
) => {
  assertShop(shop);

  const safeTake =
    typeof take === "number" && take > 0 ? Math.min(take, 100) : 20;

  return getClient(options).bulkMutationSubmission.findMany({
    where: {
      shop,
      ...(status ? { status } : {}),
      ...(mutationType ? { mutationType } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: safeTake,
    select: buildSelect(options.select),
  });
};
