export const OPERATION_TRANSITIONS = {
  PLANNED: ["SNAPSHOTTING", "FAILED", "CANCELLED"],
  SNAPSHOTTING: ["SNAPSHOTTED", "FAILED"],
  SNAPSHOTTED: ["DISPATCHING", "FAILED", "CANCELLED"],
  DISPATCHING: ["AWAITING_SHOPIFY", "FAILED"],
  AWAITING_SHOPIFY: ["APPLYING_RESULTS", "FAILED"],
  APPLYING_RESULTS: ["VERIFYING", "FAILED"],
  VERIFYING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function assertOperationTransition(from, to) {
  const allowed = OPERATION_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid operation transition: ${from} -> ${to}`);
  }
}
