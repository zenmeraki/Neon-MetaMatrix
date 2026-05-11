export const EXECUTION_PLANNER_STATES = Object.freeze({
  PLANNED: "PLANNED",
  SNAPSHOTTING: "SNAPSHOTTING",
  SNAPSHOTTED: "SNAPSHOTTED",
  DISPATCHING: "DISPATCHING",
  AWAITING_SHOPIFY: "AWAITING_SHOPIFY",
  APPLYING_RESULTS: "APPLYING_RESULTS",
  VERIFYING: "VERIFYING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
});

const ALLOWED = Object.freeze({
  PLANNED: new Set(["SNAPSHOTTING", "FAILED", "CANCELLED"]),
  SNAPSHOTTING: new Set(["SNAPSHOTTED", "FAILED", "CANCELLED"]),
  SNAPSHOTTED: new Set(["DISPATCHING", "FAILED", "CANCELLED"]),
  DISPATCHING: new Set(["AWAITING_SHOPIFY", "FAILED", "CANCELLED"]),
  AWAITING_SHOPIFY: new Set(["APPLYING_RESULTS", "FAILED", "CANCELLED"]),
  APPLYING_RESULTS: new Set(["VERIFYING", "FAILED", "CANCELLED"]),
  VERIFYING: new Set(["COMPLETED", "FAILED", "CANCELLED"]),
  COMPLETED: new Set(),
  FAILED: new Set(),
  CANCELLED: new Set(),
});

export function assertPlannerTransition(from, to) {
  const next = ALLOWED[from];
  if (!next || !next.has(to)) {
    const error = new Error(`INVALID_PLANNER_TRANSITION:${from}->${to}`);
    error.code = "INVALID_PLANNER_TRANSITION";
    throw error;
  }
}

export function assertCompletionAllowed({ to, verificationPassed }) {
  if (to === EXECUTION_PLANNER_STATES.COMPLETED && verificationPassed !== true) {
    const error = new Error("VERIFICATION_REQUIRED_BEFORE_COMPLETION");
    error.code = "VERIFICATION_REQUIRED_BEFORE_COMPLETION";
    throw error;
  }
}
