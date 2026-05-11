import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExportIdempotencyKey,
  buildExportManifest,
  isExportDownloadReady,
} from "./modules/productExports/exportRequestManifest.js";

test("concurrent start contract: same export request maps to one deterministic idempotency key", () => {
  const manifestA = buildExportManifest({
    shop: "shop-a.myshopify.com",
    source: "manual_export",
    preset: "custom",
    filename: "products.csv",
    resolvedFields: ["ProductID", "SKU", "Price"],
    targetSnapshotId: "snapshot_1",
    plannerFingerprint: "fp_1",
    mirrorBatchId: "batch_1",
  });
  const manifestB = buildExportManifest({
    shop: "shop-a.myshopify.com",
    source: "manual_export",
    preset: "custom",
    filename: "products.csv",
    resolvedFields: ["ProductID", "SKU", "Price"],
    targetSnapshotId: "snapshot_1",
    plannerFingerprint: "fp_1",
    mirrorBatchId: "batch_1",
  });

  assert.equal(
    buildExportIdempotencyKey(manifestA),
    buildExportIdempotencyKey(manifestB),
  );
});

test("deterministic replay contract: any meaningful manifest change rotates idempotency key", () => {
  const base = buildExportManifest({
    shop: "shop-a.myshopify.com",
    source: "manual_export",
    preset: "custom",
    filename: "products.csv",
    resolvedFields: ["ProductID", "SKU", "Price"],
    targetSnapshotId: "snapshot_1",
    plannerFingerprint: "fp_1",
    mirrorBatchId: "batch_1",
  });
  const changed = buildExportManifest({
    ...base,
    resolvedFields: ["ProductID", "SKU", "CompareAtPrice"],
  });

  assert.notEqual(
    buildExportIdempotencyKey(base),
    buildExportIdempotencyKey(changed),
  );
});

test("download-not-ready contract: fileUrl is required before redirect", () => {
  assert.equal(isExportDownloadReady({ fileUrl: null }), false);
  assert.equal(isExportDownloadReady({}), false);
  assert.equal(isExportDownloadReady({ fileUrl: "https://cdn.example.com/x.csv" }), true);
});
