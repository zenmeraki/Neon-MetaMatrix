import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOperationSpine,
  explainOperationSpine,
} from "./services/execution/operationSpineService.js";

const COMPLETE_INPUT = Object.freeze({
  shop: "unit-test.myshopify.com",
  operationId: "op_1",
  mirrorBatch: { id: "batch_1", hash: "batch_1", status: "ACTIVE" },
  canonicalFilterAst: { id: "intent_1", hash: "filter_hash" },
  targetSnapshotSet: { id: "snapshot_1", hash: "target_hash", count: 10 },
  executionPlan: { id: "plan_1", hash: "plan_hash", count: 10, status: "CREATED" },
  beforeValueSnapshot: { id: "snapshot_1", hash: "before_hash", count: 10 },
  shopifyBulkMutation: { id: "gid://shopify/BulkOperation/1", hash: "payload_hash", status: "COMPLETED" },
  verificationSnapshot: { id: "verification_1", hash: "verification_hash", status: "VERIFIED" },
  undoPlan: { id: "undo_plan_1", hash: "undo_hash", count: 10, status: "CREATED" },
});

test("complete spine exposes the moat capabilities", () => {
  const spine = buildOperationSpine(COMPLETE_INPUT);

  assert.equal(spine.completeThroughStage, "UndoPlan");
  assert.deepEqual(spine.missingStages, []);
  assert.equal(spine.capabilities.previewable, true);
  assert.equal(spine.capabilities.freezable, true);
  assert.equal(spine.capabilities.verifiable, true);
  assert.equal(spine.capabilities.undoable, true);
  assert.equal(spine.capabilities.replayable, true);
  assert.equal(spine.capabilities.explainable, true);
  assert.equal(spine.capabilities.auditable, true);
  assert.match(spine.spineHash, /^[a-f0-9]{64}$/);
});

test("spine hash is stable for semantically identical evidence", () => {
  const first = buildOperationSpine(COMPLETE_INPUT);
  const second = buildOperationSpine({
    operationId: "op_1",
    shop: "unit-test.myshopify.com",
    undoPlan: { status: "CREATED", count: 10, hash: "undo_hash", id: "undo_plan_1" },
    verificationSnapshot: { status: "VERIFIED", hash: "verification_hash", id: "verification_1" },
    shopifyBulkMutation: { status: "COMPLETED", hash: "payload_hash", id: "gid://shopify/BulkOperation/1" },
    beforeValueSnapshot: { count: 10, hash: "before_hash", id: "snapshot_1" },
    executionPlan: { status: "CREATED", count: 10, hash: "plan_hash", id: "plan_1" },
    targetSnapshotSet: { count: 10, hash: "target_hash", id: "snapshot_1" },
    canonicalFilterAst: { hash: "filter_hash", id: "intent_1" },
    mirrorBatch: { status: "ACTIVE", hash: "batch_1", id: "batch_1" },
  });

  assert.equal(first.spineHash, second.spineHash);
});

test("spine rejects later-stage evidence without the missing predecessor", () => {
  assert.throws(
    () =>
      buildOperationSpine({
        shop: "unit-test.myshopify.com",
        operationId: "op_2",
        mirrorBatch: { id: "batch_1" },
        canonicalFilterAst: { id: "intent_1", hash: "filter_hash" },
        executionPlan: { id: "plan_1", hash: "plan_hash" },
      }),
    /OPERATION_SPINE_OUT_OF_ORDER/,
  );
});

test("spine explanation returns ordered audit evidence", () => {
  const spine = buildOperationSpine({
    shop: "unit-test.myshopify.com",
    operationId: "op_3",
    mirrorBatch: { id: "batch_1" },
    canonicalFilterAst: { id: "intent_1", hash: "filter_hash" },
  });
  const explanation = explainOperationSpine(spine);

  assert.deepEqual(
    explanation.map((entry) => entry.stage),
    [
      "MirrorBatch",
      "CanonicalFilterAST",
      "TargetSnapshotSet",
      "ExecutionPlan",
      "BeforeValueSnapshot",
      "ShopifyBulkMutation",
      "VerificationSnapshot",
      "UndoPlan",
    ],
  );
  assert.equal(explanation[0].present, true);
  assert.equal(explanation[1].hash, "filter_hash");
  assert.equal(explanation[2].present, false);
});
