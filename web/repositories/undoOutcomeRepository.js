import { prisma } from "../Config/database.js";

/**
 * UndoOutcome repository.
 *
 * Storage:
 * - BulkMutationOutcome rows are used as the current audit table for undo
 *   target outcomes.
 *
 * No responsibilities:
 * - Shopify calls
 * - undo planning
 * - controller response shaping
 */

const DEFAULT_SELECT = {
  id: true,
  bulkMutationSubmissionId: true,
  shop: true,
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
  if (!id || typeof id !== "string") {
    throw new Error(`${fieldName} is required`);
  }
};

const assertShop = (shop) => {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required");
  }
};

const buildSelect = (select) => select || DEFAULT_SELECT;

export const createUndoOutcome = async (data, options = {}) => {
  if (!data || typeof data !== "object") {
    throw new Error("data is required");
  }

  assertId(data.bulkMutationSubmissionId, "bulkMutationSubmissionId");
  assertShop(data.shop);

  if (!data.status) {
    throw new Error("status is required");
  }

  return prisma.bulkMutationOutcome.create({
    data: {
      ...data,
      raw: {
        ...(data.raw && typeof data.raw === "object" ? data.raw : {}),
        auditType: "UNDO",
      },
    },
    select: buildSelect(options.select),
  });
};

export const createManyUndoOutcomes = async (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("rows must be a non-empty array");
  }

  const normalizedRows = rows.map((row) => {
    assertId(row?.bulkMutationSubmissionId, "bulkMutationSubmissionId");
    assertShop(row?.shop);

    if (!row.status) {
      throw new Error("status is required");
    }

    return {
      ...row,
      raw: {
        ...(row.raw && typeof row.raw === "object" ? row.raw : {}),
        auditType: "UNDO",
      },
    };
  });

  return prisma.bulkMutationOutcome.createMany({
    data: normalizedRows,
    skipDuplicates: true,
  });
};

export const listUndoOutcomesBySubmissionId = async (
  bulkMutationSubmissionId,
  options = {},
) => {
  assertId(bulkMutationSubmissionId, "bulkMutationSubmissionId");

  const take =
    typeof options.take === "number" && options.take > 0
      ? Math.min(options.take, 1000)
      : 100;

  return prisma.bulkMutationOutcome.findMany({
    where: {
      bulkMutationSubmissionId,
    },
    orderBy: { createdAt: "asc" },
    take,
    select: buildSelect(options.select),
  });
};

export const summarizeUndoOutcomesBySubmissionId = async (
  bulkMutationSubmissionId,
) => {
  assertId(bulkMutationSubmissionId, "bulkMutationSubmissionId");

  const grouped = await prisma.bulkMutationOutcome.groupBy({
    by: ["status"],
    where: {
      bulkMutationSubmissionId,
    },
    _count: {
      status: true,
    },
  });

  return grouped.reduce(
    (summary, row) => ({
      ...summary,
      [row.status]: row._count.status,
    }),
    {},
  );
};

