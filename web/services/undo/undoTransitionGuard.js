import { prisma } from "../../config/database.js";

const STATUS_ALIAS = Object.freeze({
  VALIDATING: "VALIDATING_CURRENT_STATE",
  VALIDATED: "VALIDATED_SAFE",
  CONFLICTS_FOUND: "VALIDATED_WITH_CONFLICTS",
});

const ALLOWED_TRANSITIONS = Object.freeze({
  REQUESTED: ["FREEZING"],
  FREEZING: ["FROZEN", "FAILED"],
  FROZEN: ["VALIDATING_CURRENT_STATE", "FAILED"],
  VALIDATING_CURRENT_STATE: ["VALIDATED_SAFE", "VALIDATED_WITH_CONFLICTS", "FAILED"],
  VALIDATED_SAFE: ["PLAN_CREATED", "FAILED"],
  VALIDATED_WITH_CONFLICTS: ["PLAN_CREATED", "FAILED"],
  PLAN_CREATED: ["DISPATCHING", "FAILED"],
  DISPATCHING: ["AWAITING_SHOPIFY", "FAILED"],
  AWAITING_SHOPIFY: ["COMPLETED", "PARTIAL_COMPLETED", "FAILED"],
});

function normalizeStatus(status) {
  const key = String(status || "").trim().toUpperCase();
  return STATUS_ALIAS[key] || key;
}

export function assertUndoRequestTransition(fromStatus, toStatus) {
  const from = normalizeStatus(fromStatus);
  const to = normalizeStatus(toStatus);

  if (!from) {
    throw new Error("UNDO_REQUEST_STATUS_MISSING");
  }
  if (!to) {
    throw new Error("UNDO_REQUEST_TARGET_STATUS_MISSING");
  }
  if (from === to) {
    return to;
  }

  const allowed = ALLOWED_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    const error = new Error(`UNDO_REQUEST_INVALID_TRANSITION:${from}->${to}`);
    error.code = "UNDO_REQUEST_INVALID_TRANSITION";
    throw error;
  }

  return to;
}

export async function transitionUndoRequestStatus({
  shop,
  undoRequestId,
  toStatus,
  db = prisma,
}) {
  const request = await db.undoRequest.findFirst({
    where: {
      id: undoRequestId,
      shop,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!request?.id) {
    throw new Error("UNDO_REQUEST_NOT_FOUND");
  }

  const normalizedTo = assertUndoRequestTransition(request.status, toStatus);

  const updated = await db.undoRequest.updateMany({
    where: {
      id: request.id,
      shop,
      status: request.status,
    },
    data: {
      status: normalizedTo,
    },
  });

  if (updated.count !== 1) {
    throw new Error("UNDO_REQUEST_TRANSITION_CONFLICT");
  }

  return normalizedTo;
}
