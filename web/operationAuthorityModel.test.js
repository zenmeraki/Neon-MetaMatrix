import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTHORITATIVE_MODELS,
  PROJECTION_MODELS,
  isAuthoritativeModel,
  isProjectionModel,
} from "./services/execution/operationAuthorityModel.js";

test("authority model lists are disjoint", () => {
  const overlap = AUTHORITATIVE_MODELS.filter((model) =>
    PROJECTION_MODELS.includes(model),
  );
  assert.deepEqual(overlap, []);
});

test("required authoritative models are present", () => {
  const required = [
    "MerchantOperation",
    "OperationExecution",
    "OperationSubmission",
    "TargetSnapshotSet",
    "ImmutableTargetSnapshotSet",
    "TargetSnapshot",
    "ImmutableTargetSnapshotItem",
    "ChangeRecord",
    "ExportArtifact",
  ];
  for (const model of required) {
    assert.equal(isAuthoritativeModel(model), true, `${model} must be authoritative`);
    assert.equal(isProjectionModel(model), false, `${model} must not be projection`);
  }
});

test("required projection models are present", () => {
  const required = [
    "EditHistory",
    "ExportHistory",
    "ExportJob",
    "BulkUndoExecution",
    "StoreOperation",
  ];
  for (const model of required) {
    assert.equal(isProjectionModel(model), true, `${model} must be projection`);
    assert.equal(isAuthoritativeModel(model), false, `${model} must not be authoritative`);
  }
});

