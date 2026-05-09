import test from "node:test";
import assert from "node:assert/strict";
import {
  graphqlProductCollectionsBulkSyncQuery,
  graphqlProductMetafieldsBulkSyncQuery,
  graphqlProductVariantsBulkSyncQuery,
  graphqlProductsExportQuery,
  graphqlProductsLiveExportQuery,
} from "./product.js";

test("variant sync query is rooted at productVariants", () => {
  assert.match(graphqlProductVariantsBulkSyncQuery, /\bproductVariants\s*\{/);
  assert.doesNotMatch(graphqlProductVariantsBulkSyncQuery, /\bproducts\s*\{[\s\S]*\bvariants\s*\{/);
  assert.match(graphqlProductVariantsBulkSyncQuery, /\bproduct\s*\{[\s\S]*\bid\b/);
  assert.match(graphqlProductVariantsBulkSyncQuery, /\bupdatedAt\b/);
});

test("metafield sync query has explicit capped temporary owner payload", () => {
  assert.match(graphqlProductMetafieldsBulkSyncQuery, /\bmetafields\(first:\s*250\)/);
  assert.match(graphqlProductMetafieldsBulkSyncQuery, /\bowner\s*\{[\s\S]*\.\.\. on Product[\s\S]*\bid\b/);
});

test("collection sync query is rooted at collections with product membership", () => {
  assert.match(graphqlProductCollectionsBulkSyncQuery, /\bcollections\s*\{/);
  assert.match(graphqlProductCollectionsBulkSyncQuery, /\bproducts\s*\{[\s\S]*\bid\b/);
});

test("legacy export query name points to live export query", () => {
  assert.equal(graphqlProductsExportQuery, graphqlProductsLiveExportQuery);
});
