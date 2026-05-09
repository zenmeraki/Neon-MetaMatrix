import { prisma } from "../../config/database.js";
import { transitionUndoRequestStatus } from "./undoTransitionGuard.js";

export async function freezeUndoTargets({ shop, undoRequestId, executionId }) {
  await transitionUndoRequestStatus({
    shop,
    undoRequestId,
    toStatus: "FREEZING",
  });

  const changes = await prisma.changeRecord.findMany({
    where: {
      shop,
      executionId,
    },
    orderBy: [{ productId: "asc" }, { variantId: "asc" }, { field: "asc" }],
  });

  if (!changes.length) {
    throw new Error("NO_CHANGE_RECORDS_TO_UNDO");
  }

  await prisma.undoTarget.createMany({
    data: changes.map((change) => ({
      shop,
      undoRequestId,
      changeRecordId: change.id,
      productId: change.productId,
      variantId: change.variantId,
      field: change.field || "",
      beforeValueJson: change.beforeValueJson ?? change.beforeValue ?? null,
      afterValueJson: change.afterValueJson ?? change.afterValue ?? null,
      expectedAfterFingerprint: change.afterFingerprint ?? null,
      status: "PENDING",
    })),
    skipDuplicates: true,
  });

  await transitionUndoRequestStatus({
    shop,
    undoRequestId,
    toStatus: "FROZEN",
  });

  return changes.length;
}
