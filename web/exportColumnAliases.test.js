import assert from "node:assert/strict";
import test from "node:test";

import { buildCsvHeaders } from "./modules/productExports/exportColumnAliases.js";

test("matrixify preset emits canonical header aliases", () => {
  const headers = buildCsvHeaders(
    ["title", "description", "sku", "option1Name", "option1Values"],
    {
      includeVariantId: true,
      preset: "matrixify",
    },
  );

  assert.deepEqual(headers, [
    "ID",
    "Variant ID",
    "Title",
    "Body HTML",
    "Variant SKU",
    "Option1 Name",
    "Option1 Value",
  ]);
});

test("google_shopping preset emits canonical header aliases", () => {
  const headers = buildCsvHeaders(
    [
      "title",
      "description",
      "handle",
      "vendor",
      "price",
      "compareAtPrice",
      "googleShoppingCategory",
      "googleShoppingCustomLabel0",
    ],
    {
      includeVariantId: true,
      preset: "google_shopping",
    },
  );

  assert.deepEqual(headers, [
    "id",
    "item_group_id",
    "title",
    "description",
    "link",
    "brand",
    "price",
    "sale_price",
    "google_product_category",
    "custom_label_0",
  ]);
});

