import test from "node:test";
import assert from "node:assert/strict";
import {
  assertReplayExecuteRequiresSnapshot,
  diffTargetIds,
} from "./services/execution/operationReplayContracts.js";

test("drift preview contract: reports added/removed between previous and current target sets", () => {
  const previous = new Set(["p1", "p2", "p3"]);
  const current = new Set(["p2", "p3", "p4", "p5"]);
  const drift = diffTargetIds(previous, current);

  assert.equal(drift.previousTargetCount, 3);
  assert.equal(drift.currentTargetCount, 4);
  assert.equal(drift.addedCount, 2);
  assert.equal(drift.removedCount, 1);
  assert.deepEqual(drift.addedSample.sort(), ["p4", "p5"]);
  assert.deepEqual(drift.removedSample, ["p1"]);
});

test("strict snapshot requirement: replay execute rejects missing targetSnapshotId", () => {
  assert.throws(
    () =>
      assertReplayExecuteRequiresSnapshot({
        targetSnapshotId: "",
      }),
    (err) => err?.code === "IMMUTABLE_TARGET_REQUIRED",
  );
});

test("strict snapshot requirement helper returns normalized snapshot id", () => {
  assert.equal(
    assertReplayExecuteRequiresSnapshot({
      targetSnapshotId: "  snap_123  ",
    }),
    "snap_123",
  );
});
