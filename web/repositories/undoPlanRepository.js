import { prisma } from "../Config/database.js";

/**
 * UndoPlan repository.
 *
 * Transitional storage:
 * - EditHistory.undo JSON is the current undo plan truth.
 *
 * Responsibilities:
 * - Prisma access only
 * - read/update undo plan JSON
 * - preserve existing EditHistory compatibility
 */

const DEFAULT_SELECT = {
  id: true,
  shop: true,
  status: true,
  undo: true,
  bulkOperationId: true,
  executionIdentity: true,
  editedType: true,
  affectedFields: true,
  totalItems: true,
  processedCount: true,
  completedAt: true,
  updatedAt: true,
  executionSummary: true,
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

const normalizeUndo = (value) => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
};

const withExecutionSummary = (row) => {
  if (!row?.executionSummary) {
    return row;
  }

  const { executionSummary, ...history } = row;
  return {
    ...history,
    ...executionSummary,
    id: history.id,
    shop: history.shop,
    updatedAt: history.updatedAt,
  };
};

export const findUndoPlanByHistoryId = async (
  { shop, historyId },
  options = {},
) => {
  assertShop(shop);
  assertId(historyId, "historyId");

  const row = await prisma.editHistory.findFirst({
    where: {
      id: historyId,
      shop,
    },
    select: buildSelect(options.select),
  });

  return withExecutionSummary(row);
};

export const listUndoPlansByShop = async (
  { shop, states = [], take = 20 },
  options = {},
) => {
  assertShop(shop);

  const safeTake =
    typeof take === "number" && take > 0 ? Math.min(take, 100) : 20;

  const rows = await prisma.editHistory.findMany({
    where: {
      shop,
      undo: {
        not: null,
      },
      ...(Array.isArray(states) && states.length > 0
        ? {
            OR: states.map((state) => ({
              undo: {
                path: ["state"],
                equals: state,
              },
            })),
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: safeTake,
    select: buildSelect(options.select),
  });

  return rows.map(withExecutionSummary);
};

export const updateUndoPlan = async (
  { shop, historyId, patch },
  options = {},
) => {
  assertShop(shop);
  assertId(historyId, "historyId");

  if (!patch || typeof patch !== "object") {
    throw new Error("patch is required");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.editHistory.findFirst({
      where: {
        id: historyId,
        shop,
      },
      select: {
        id: true,
        undo: true,
      },
    });

    if (!existing) {
      return null;
    }

    const updated = await tx.editHistory.update({
      where: { id: historyId },
      data: {
        undo: {
          ...normalizeUndo(existing.undo),
          ...patch,
        },
      },
      select: buildSelect(options.select),
    });

    return withExecutionSummary(updated);
  });
};

export const replaceUndoPlan = async (
  { shop, historyId, undo },
  options = {},
) => {
  assertShop(shop);
  assertId(historyId, "historyId");

  if (!undo || typeof undo !== "object") {
    throw new Error("undo is required");
  }

  return prisma.editHistory.updateMany({
    where: {
      id: historyId,
      shop,
    },
    data: {
      undo,
    },
  }).then(async (result) => {
    if (!result.count) return null;
    return findUndoPlanByHistoryId({ shop, historyId }, options);
  });
};

export const clearUndoPlan = async ({ shop, historyId }, options = {}) => {
  assertShop(shop);
  assertId(historyId, "historyId");

  const updated = await prisma.editHistory.update({
    where: { id: historyId },
    data: {
      undo: null,
    },
    select: buildSelect(options.select),
  });

  return withExecutionSummary(updated);
};
