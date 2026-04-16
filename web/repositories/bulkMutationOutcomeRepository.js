import { prisma } from "../Config/database.js";

/**
 * BulkMutationOutcome repository.
 *
 * Prisma-only boundary for mutation outcome rows.
 */

const DEFAULT_SELECT = {
  id: true,
  bulkMutationSubmissionId: true,
  shop: true,
  targetSnapshotSetId: true,
  catalogBatchId: true,
  dedupeKey: true,
  targetId: true,
  productId: true,
  variantId: true,
  status: true,
  code: true,
  message: true,
  raw: true,
  createdAt: true,
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

const buildSelect = (select) => select || DEFAULT_SELECT;
const getClient = (options = {}) => options.tx || prisma;
const DEFAULT_CREATE_MANY_BATCH_SIZE = 500;

export const createBulkMutationOutcome = async (data, options = {}) => {
  if (!data || typeof data !== "object") {
    throw new Error("data is required");
  }

  assertId(data.bulkMutationSubmissionId, "bulkMutationSubmissionId");
  assertShop(data.shop);

  if (!data.status) {
    throw new Error("status is required");
  }

  return getClient(options).bulkMutationOutcome.create({
    data,
    select: buildSelect(options.select),
  });
};

export const createManyBulkMutationOutcomes = async (rows, options = {}) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("rows must be a non-empty array");
  }

  for (const row of rows) {
    assertId(row?.bulkMutationSubmissionId, "bulkMutationSubmissionId");
    assertShop(row?.shop);
    if (!row.status) throw new Error("status is required");
  }

  const batchSize =
    typeof options.batchSize === "number" && options.batchSize > 0
      ? Math.min(options.batchSize, 1000)
      : DEFAULT_CREATE_MANY_BATCH_SIZE;

  const insertBatches = async (client) => {
    let count = 0;
    for (let index = 0; index < rows.length; index += batchSize) {
      const result = await client.bulkMutationOutcome.createMany({
        data: rows.slice(index, index + batchSize),
        skipDuplicates: true,
      });
      count += result.count || 0;
    }
    return { count };
  };

  if (options.tx) {
    return insertBatches(options.tx);
  }

  return prisma.$transaction((tx) => insertBatches(tx));
};

export const listOutcomesBySubmissionId = async (
  bulkMutationSubmissionId,
  options = {},
) => {
  assertId(bulkMutationSubmissionId, "bulkMutationSubmissionId");

  const take =
    typeof options.take === "number" && options.take > 0
      ? Math.min(options.take, 1000)
      : 100;

  return getClient(options).bulkMutationOutcome.findMany({
    where: { bulkMutationSubmissionId },
    orderBy: { createdAt: "asc" },
    take,
    select: buildSelect(options.select),
  });
};

export const summarizeOutcomesBySubmissionId = async (
  bulkMutationSubmissionId,
) => {
  assertId(bulkMutationSubmissionId, "bulkMutationSubmissionId");

  const grouped = await prisma.bulkMutationOutcome.groupBy({
    by: ["status"],
    where: { bulkMutationSubmissionId },
    _count: {
      status: true,
    },
  });

  return grouped.reduce((summary, row) => ({
    ...summary,
    [row.status]: row._count.status,
  }), {});
};

export const deleteOutcomesBySubmissionId = async (
  bulkMutationSubmissionId,
) => {
  assertId(bulkMutationSubmissionId, "bulkMutationSubmissionId");

  return prisma.bulkMutationOutcome.deleteMany({
    where: { bulkMutationSubmissionId },
  });
};
