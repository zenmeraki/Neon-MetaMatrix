import crypto from "crypto";
import { prisma } from "../../config/database.js";
import { UNDO_TARGET_STATUS } from "./undoStatus.constants.js";
import { transitionUndoRequestStatus } from "./undoTransitionGuard.js";

function hashPlan(planJson) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(planJson))
    .digest("hex");
}

export async function buildUndoExecutionPlan({ shop, undoRequestId }) {
  const safeTargets = await prisma.undoTarget.findMany({
    where: {
      shop,
      undoRequestId,
      status: UNDO_TARGET_STATUS.SAFE,
    },
    orderBy: [{ productId: "asc" }, { variantId: "asc" }, { field: "asc" }],
  });

  if (!safeTargets.length) {
    throw new Error("NO_SAFE_TARGETS_TO_UNDO");
  }

  const mutations = safeTargets.map((target) => ({
    undoTargetId: target.id,
    productId: target.productId,
    variantId: target.variantId,
    field: target.field,
    restoreValueJson: target.beforeValueJson,
    expectedCurrentValueJson: target.afterValueJson,
    expectedAfterFingerprint: target.expectedAfterFingerprint || null,
  }));

  const planJson = {
    schemaVersion: "2026-05-07.safeUndoPlan.v1",
    undoRequestId,
    mutationCount: mutations.length,
    mutations,
  };

  const planHash = hashPlan(planJson);

  const plan = await prisma.undoExecutionPlan.upsert({
    where: {
      shop_undoRequestId: {
        shop,
        undoRequestId,
      },
    },
    update: {},
    create: {
      shop,
      undoRequestId,
      status: "CREATED",
      mutationCount: mutations.length,
      planHash,
      planJson,
    },
  });

  await transitionUndoRequestStatus({
    shop,
    undoRequestId,
    toStatus: "PLAN_CREATED",
  });

  return plan;
}
