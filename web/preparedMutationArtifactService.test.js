import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import {
  assertPreparedMutationArtifactReady,
  buildPreparedMutationRows,
  createPreparedMutationArtifact,
} from "./services/execution/preparedMutationArtifactService.js";

test("prepared mutation rows merge productSet scalar updates by product", () => {
  const { rows, skipped } = buildPreparedMutationRows([
    {
      productId: "gid://shopify/Product/1",
      field: "title",
      afterValueJson: { field: "New title" },
    },
    {
      productId: "gid://shopify/Product/1",
      field: "vendor",
      afterValueJson: { field: "Acme" },
    },
  ]);

  assert.deepEqual(rows, [
    {
      productSet: {
        id: "gid://shopify/Product/1",
        title: "New title",
        vendor: "Acme",
      },
    },
  ]);
  assert.deepEqual(skipped, []);
});

test("prepared mutation rows skip unsupported mutations instead of inventing payloads", () => {
  const { rows, skipped, pipelineStats } = buildPreparedMutationRows([
    {
      productId: "gid://shopify/Product/1",
      variantId: "gid://shopify/ProductVariant/1",
      field: "unknownVariantField",
      afterValueJson: { field: "12.00" },
    },
    {
      productId: "gid://shopify/Product/2",
      field: "unknownField",
      afterValueJson: { field: "value" },
    },
  ]);

  assert.deepEqual(rows, []);
  assert.equal(skipped.length, 2);
  assert.equal(skipped[0].reason, "VARIANT_MUTATION_NOT_SERIALIZED");
  assert.equal(skipped[1].reason, "UNSUPPORTED_PRODUCT_SET_FIELD");
  assert.deepEqual(pipelineStats, {});
});

test("field-specific pipelines serialize price, seo, tags, and metafields", () => {
  const { rows, skipped, pipelineStats } = buildPreparedMutationRows([
    {
      productId: "gid://shopify/Product/1",
      variantId: "gid://shopify/ProductVariant/1",
      field: "price",
      afterValueJson: { field: 19.99 },
    },
    {
      productId: "gid://shopify/Product/1",
      field: "seoTitle",
      afterValueJson: { field: "SEO title" },
    },
    {
      productId: "gid://shopify/Product/1",
      field: "tags",
      afterValueJson: { field: ["summer", "sale"] },
    },
    {
      productId: "gid://shopify/Product/1",
      field: "metafield",
      afterValueJson: {
        field: {
          namespace: "custom",
          key: "material",
          type: "single_line_text_field",
          value: "cotton",
        },
      },
    },
  ]);

  assert.equal(skipped.length, 0);
  assert.deepEqual(rows, [
    {
      productSet: {
        id: "gid://shopify/Product/1",
        variants: [{ id: "gid://shopify/ProductVariant/1", price: 19.99 }],
        seo: { title: "SEO title" },
        tags: ["summer", "sale"],
        metafields: [
          {
            namespace: "custom",
            key: "material",
            type: "single_line_text_field",
            value: "cotton",
          },
        ],
      },
    },
  ]);
  assert.deepEqual(pipelineStats, {
    price: 1,
    seo: 1,
    tag: 1,
    metafield: 1,
  });
});

test("inventory pipeline emits location-aware inventoryQuantities format when location is provided", () => {
  const { rows, skipped, pipelineStats, format } = buildPreparedMutationRows(
    [
      {
        productId: "gid://shopify/Product/1",
        variantId: "gid://shopify/ProductVariant/1",
        field: "inventoryQuantity",
        afterValueJson: { field: 12 },
      },
    ],
    { inventoryLocationId: "gid://shopify/Location/1" },
  );

  assert.equal(skipped.length, 0);
  assert.deepEqual(rows, [
    {
      productSet: {
        id: "gid://shopify/Product/1",
        variants: [
          {
            id: "gid://shopify/ProductVariant/1",
            inventoryQuantities: [
              {
                locationId: "gid://shopify/Location/1",
                availableQuantity: 12,
              },
            ],
          },
        ],
      },
    },
  ]);
  assert.deepEqual(pipelineStats, { inventory: 1 });
  assert.equal(
    format,
    "shopify.bulkMutationVariables.inventoryQuantities.productSet.v1",
  );
});

test("coalescing is deterministic and reports field conflicts", () => {
  const { rows, conflictSummary, coalescingPolicy } = buildPreparedMutationRows([
    {
      productId: "gid://shopify/Product/1",
      field: "title",
      afterValueJson: { field: "First title" },
    },
    {
      productId: "gid://shopify/Product/1",
      field: "title",
      afterValueJson: { field: "Final title" },
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].productSet.title, "Final title");
  assert.equal(conflictSummary.totalConflicts, 1);
  assert.equal(conflictSummary.byScope.product, 1);
  assert.equal(coalescingPolicy.strategy, "last_write_wins");
});

test("prepared mutation artifact is checksum and row-count verifiable", async () => {
  const artifact = await createPreparedMutationArtifact({
    shop: "unit-test.myshopify.com",
    operationId: `op_${Date.now()}`,
    intentHash: "intent_hash",
    mutations: [
      {
        productId: "gid://shopify/Product/1",
        field: "title",
        afterValueJson: { field: "Prepared" },
      },
    ],
  });

  assert.equal(artifact.prepared, true);
  assert.equal(artifact.rowCount, 1);
  assert.match(artifact.checksum, /^[a-f0-9]{64}$/);

  const verified = await assertPreparedMutationArtifactReady({ artifact });
  assert.equal(verified.rowCount, 1);
  assert.equal(verified.checksum, artifact.checksum);

  await fs.rm(artifact.path, { force: true });
});
