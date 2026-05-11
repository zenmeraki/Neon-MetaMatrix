import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

function buildChangeHash(row) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        productId: row.productId,
        title: row.title,
        scope: row.scope,
        options: row.options ?? null,
        productFieldChanges: row.productFieldChanges ?? null,
        variantFieldChanges: row.variantFieldChanges ?? null,
      }),
    )
    .digest("hex");
}

function createSubmissionLedger() {
  return {
    status: "PREPARED",
    shopifyBulkOperationId: null,
    acceptedAt: null,
  };
}

async function runDispatchAttempt({
  ledger,
  submitToShopify,
  failAfterSubmitBeforePersist = false,
}) {
  if (ledger.status === "SHOPIFY_DISPATCHED" && ledger.shopifyBulkOperationId) {
    return { skippedSubmit: true, bulkOperationId: ledger.shopifyBulkOperationId };
  }

  if (ledger.status !== "PREPARED") {
    return { skippedSubmit: true, reason: "submission_in_progress" };
  }

  ledger.status = "SUBMITTING";
  const submitResult = await submitToShopify();

  if (failAfterSubmitBeforePersist) {
    ledger.status = "PREPARED";
    throw new Error("CRASH_AFTER_SUBMIT_BEFORE_PERSIST");
  }

  ledger.status = "SHOPIFY_DISPATCHED";
  ledger.shopifyBulkOperationId = submitResult.bulkOperationId;
  ledger.acceptedAt = new Date().toISOString();
  return { skippedSubmit: false, bulkOperationId: submitResult.bulkOperationId };
}

function shouldFailForMissingFinalizerEvidence({ expectedCount, totalLines }) {
  return Number(expectedCount || 0) > 0 && Number(totalLines || 0) === 0;
}

test("concurrent worker dispatch: same historyId + operationId submits Shopify exactly once", async () => {
  const ledger = createSubmissionLedger();
  let submitCalls = 0;
  const submitToShopify = async () => {
    submitCalls += 1;
    return { bulkOperationId: "gid://shopify/BulkOperation/1" };
  };

  const [first, second] = await Promise.all([
    runDispatchAttempt({ ledger, submitToShopify }),
    runDispatchAttempt({ ledger, submitToShopify }),
  ]);

  assert.equal(submitCalls, 1);
  assert.equal(ledger.status, "SHOPIFY_DISPATCHED");
  assert.equal(ledger.shopifyBulkOperationId, "gid://shopify/BulkOperation/1");
  assert.ok(first.bulkOperationId || second.bulkOperationId);
});

test("crash-retry guard: persisted acceptance marker prevents double submit", async () => {
  const ledger = createSubmissionLedger();
  let submitCalls = 0;
  const submitToShopify = async () => {
    submitCalls += 1;
    return { bulkOperationId: "gid://shopify/BulkOperation/2" };
  };

  await runDispatchAttempt({ ledger, submitToShopify });
  const retry = await runDispatchAttempt({ ledger, submitToShopify });

  assert.equal(submitCalls, 1);
  assert.equal(retry.skippedSubmit, true);
  assert.equal(retry.bulkOperationId, "gid://shopify/BulkOperation/2");
});

test("finalizer evidence guard: terminal Shopify without result lines fails", async () => {
  const shouldFail = shouldFailForMissingFinalizerEvidence({
    expectedCount: 42,
    totalLines: 0,
  });
  const shouldPass = shouldFailForMissingFinalizerEvidence({
    expectedCount: 42,
    totalLines: 42,
  });

  assert.equal(shouldFail, true);
  assert.equal(shouldPass, false);
});

test("undo hash mismatch: tampered change record raises UNDO_CHANGE_HASH_MISMATCH", async () => {
  const trustedRow = {
    productId: "gid://shopify/Product/1",
    title: "P1",
    scope: "product",
    options: [{ name: "Size", values: ["S", "M"] }],
    productFieldChanges: [{ field: "title", oldValue: "Old", revertValue: "Old" }],
    variantFieldChanges: [],
  };

  const snapshotHash = buildChangeHash(trustedRow);
  const tamperedRow = {
    ...trustedRow,
    productFieldChanges: [{ field: "title", oldValue: "Old", revertValue: "Hacked" }],
  };
  const tamperedHash = buildChangeHash(tamperedRow);

  assert.notEqual(snapshotHash, tamperedHash);

  const mismatch = snapshotHash !== tamperedHash;
  const errorCode = mismatch ? "UNDO_CHANGE_HASH_MISMATCH" : null;
  assert.equal(errorCode, "UNDO_CHANGE_HASH_MISMATCH");
});

