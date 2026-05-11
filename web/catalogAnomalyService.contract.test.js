import test from "node:test";
import assert from "node:assert/strict";
import { analyzeRows } from "./services/execution/catalogAnomalyService.js";

function findIssue(result, code) {
  return result.issues.find((issue) => issue.code === code) || null;
}

test("detects duplicate SKUs", () => {
  const result = analyzeRows({
    variants: [
      { id: "v1", sku: "SKU-1" },
      { id: "v2", sku: "SKU-1" },
    ],
  });
  assert.equal(Boolean(findIssue(result, "DUPLICATE_SKU")), true);
});

test("detects invalid barcodes", () => {
  const result = analyzeRows({
    variants: [{ id: "v1", barcode: "ABC123" }],
  });
  assert.equal(Boolean(findIssue(result, "INVALID_BARCODE")), true);
  assert.equal(result.blocksExecution, true);
});

test("detects empty product titles", () => {
  const result = analyzeRows({
    products: [{ id: "p1", title: "   " }],
  });
  assert.equal(Boolean(findIssue(result, "EMPTY_TITLE")), true);
  assert.equal(result.blocksExecution, true);
});

test("detects compareAtPrice <= price issues", () => {
  const result = analyzeRows({
    variants: [{ id: "v1", price: 100, compareAtPrice: 90 }],
  });
  assert.equal(Boolean(findIssue(result, "COMPARE_AT_PRICE_NOT_ABOVE_PRICE")), true);
  assert.equal(result.blocksExecution, true);
});

test("detects products missing vendor/type", () => {
  const result = analyzeRows({
    products: [{ id: "p1", title: "A", vendor: "", productType: "Shirt" }],
  });
  assert.equal(Boolean(findIssue(result, "MISSING_VENDOR_OR_TYPE")), true);
});

test("detects google shopping age/gender/category gaps", () => {
  const result = analyzeRows({
    products: [
      {
        id: "p1",
        title: "A",
        vendor: "V",
        productType: "T",
        googleShoppingEnabled: true,
        googleShoppingAgeGroup: "",
        googleShoppingGender: "male",
        googleShoppingCategory: "",
      },
    ],
  });
  assert.equal(Boolean(findIssue(result, "GOOGLE_SHOPPING_FIELDS_MISSING")), true);
});

test("detects tracked variants without quantity", () => {
  const result = analyzeRows({
    variants: [{ id: "v1", tracked: true, inventoryQuantity: 0 }],
  });
  assert.equal(Boolean(findIssue(result, "TRACKED_INVENTORY_WITHOUT_QUANTITY")), true);
});

