import { prisma } from "../../config/database.js";
import { transitionUndoRequestStatus } from "./undoTransitionGuard.js";

export async function claimUndoExecutionPlan({ shop, undoExecutionPlanId }) {
  const result = await prisma.undoExecutionPlan.updateMany({
    where: {
      id: undoExecutionPlanId,
      shop,
      status: "CREATED",
    },
    data: {
      status: "DISPATCHING",
    },
  });

  if (result.count !== 1) {
    throw new Error("UNDO_PLAN_ALREADY_CLAIMED_OR_INVALID");
  }

  const plan = await prisma.undoExecutionPlan.findFirstOrThrow({
    where: {
      id: undoExecutionPlanId,
      shop,
    },
  });

  await transitionUndoRequestStatus({
    shop,
    undoRequestId: plan.undoRequestId,
    toStatus: "DISPATCHING",
  });

  return plan;
}
