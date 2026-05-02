const TRANSITIONS = {
  planned: ["queued", "failed", "cancelled"],
  queued: ["freezing", "dispatching", "running", "failed", "cancelled"],
  freezing: ["frozen", "failed", "cancelled"],
  frozen: ["dispatching", "failed", "cancelled"],
  dispatching: ["awaiting_shopify", "failed", "cancelled"],
  awaiting_shopify: ["finalizing", "failed", "cancelled"],
  finalizing: ["completed", "partial", "failed"],
  running: ["finalizing", "completed", "partial", "failed", "cancelled"],
  completed: [],
  partial: [],
  failed: ["queued"],
  cancelled: [],
};

export function assertValidTransition({ from, to }) {
  const allowed = TRANSITIONS[from] || [];

  if (!allowed.includes(to)) {
    throw new Error(`INVALID_EXECUTION_STATE_TRANSITION:${from}->${to}`);
  }

  return true;
}

export function isTerminalState(state) {
  return ["completed", "partial", "failed", "cancelled"].includes(state);
}

export function canTransition({ from, to }) {
  return Boolean(TRANSITIONS[from]?.includes(to));
}

export { TRANSITIONS };
