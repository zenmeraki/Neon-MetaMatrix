import assert from "node:assert/strict";
import test from "node:test";

const ORDER = [
  "PLANNED",
  "SNAPSHOTTING",
  "SNAPSHOTTED",
  "DISPATCHING",
  "AWAITING_SHOPIFY",
  "APPLYING_RESULTS",
  "COMPLETED",
];

function isTerminal(status) {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
}

function canTransition(from, to) {
  if (from === to) return true;
  if (isTerminal(from)) return false;
  if (to === "FAILED" || to === "CANCELLED") return true;
  const a = ORDER.indexOf(from);
  const b = ORDER.indexOf(to);
  return a >= 0 && b >= 0 && b >= a;
}

function applyTransition(op, next) {
  if (!canTransition(op.status, next.status)) {
    return { applied: false, reason: "INVALID_TRANSITION", status: op.status };
  }
  return { applied: true, status: next.status };
}

function replayCreateByIdempotencyKey(store, row) {
  const existing = store.get(`${row.shop}:${row.idempotencyKey}`);
  if (existing) return { created: false, row: existing };
  store.set(`${row.shop}:${row.idempotencyKey}`, row);
  return { created: true, row };
}

test("state machine is monotonic for non-terminal forward flow", () => {
  let op = { status: "PLANNED" };
  for (const next of [
    "SNAPSHOTTING",
    "SNAPSHOTTED",
    "DISPATCHING",
    "AWAITING_SHOPIFY",
    "APPLYING_RESULTS",
    "COMPLETED",
  ]) {
    const result = applyTransition(op, { status: next });
    assert.equal(result.applied, true);
    op = { status: result.status };
  }
});

test("terminal states are immutable", () => {
  const op = { status: "COMPLETED" };
  const result = applyTransition(op, { status: "SNAPSHOTTED" });
  assert.equal(result.applied, false);
  assert.equal(result.reason, "INVALID_TRANSITION");
});

test("idempotency key replay returns the same operation", () => {
  const store = new Map();
  const first = replayCreateByIdempotencyKey(store, {
    id: "op_1",
    shop: "s1",
    idempotencyKey: "k1",
    status: "PLANNED",
  });
  const second = replayCreateByIdempotencyKey(store, {
    id: "op_2",
    shop: "s1",
    idempotencyKey: "k1",
    status: "PLANNED",
  });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.row.id, "op_1");
});

