import { prisma } from "../../config/database.js";

function parseQueryFilter(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) return value;
  return {};
}

export async function assertEditExecutionUsesFrozenTargets({
  shop,
  historyId,
  phase = "execute",
}, db = prisma) {
  const history = await db.editHistory.findFirst({
    where: { id: historyId, shop },
    select: {
      id: true,
      shop: true,
      targetSnapshotCount: true,
      queryFilter: true,
      batch: true,
    },
  });

  if (!history) {
    const error = new Error("EDIT_HISTORY_NOT_FOUND");
    error.code = "EDIT_HISTORY_NOT_FOUND";
    throw error;
  }

  const frozenCount = await db.targetSnapshot.count({
    where: {
      ownerType: "EDIT_HISTORY",
      ownerId: history.id,
      shop: history.shop,
    },
  });

  const expectedCount = Number(history.targetSnapshotCount || 0);
  if (expectedCount > 0 && frozenCount <= 0) {
    const error = new Error("POST_FREEZE_TARGETS_MISSING");
    error.code = "POST_FREEZE_TARGETS_MISSING";
    error.details = { phase, expectedCount, frozenCount };
    throw error;
  }

  const queryFilter = parseQueryFilter(history.queryFilter);
  const hasLiveFilterPayload =
    queryFilter && Object.keys(queryFilter).length > 0;
  if (hasLiveFilterPayload) {
    const error = new Error("POST_FREEZE_FILTER_RECOMPUTE_BLOCKED");
    error.code = "POST_FREEZE_FILTER_RECOMPUTE_BLOCKED";
    error.details = { phase, historyId: history.id };
    throw error;
  }

  return { frozenCount, expectedCount };
}

