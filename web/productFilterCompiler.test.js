import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrismaNumberFilter,
  buildPrismaStringFilter,
  getProductPrismaWhere,
} from "./services/productService/productFilterCompiler.js";

test("string in filters compile to case-insensitive OR equality predicates", () => {
  assert.deepEqual(buildPrismaStringFilter("vendor", "in", [" Acme ", "Beta"]), {
    OR: [
      { vendor: { equals: "Acme", mode: "insensitive" } },
      { vendor: { equals: "Beta", mode: "insensitive" } },
    ],
  });
});

test("number does not equal compiles as negated equality", () => {
  assert.deepEqual(buildPrismaNumberFilter("price", "does not equal", "9.99"), {
    NOT: {
      price: {
        equals: 9.99,
      },
    },
  });
});

test("variant predicates include shop scope", () => {
  const where = getProductPrismaWhere(
    [{ field: "sku", operator: "equals", value: "ABC-1" }],
    "shop.myshopify.com",
  );

  assert.deepEqual(where.AND[0], {
    variants: {
      some: {
        shop: "shop.myshopify.com",
        sku: {
          equals: "ABC-1",
          mode: "insensitive",
        },
      },
    },
  });
});

test("unsupported fields fail closed", () => {
  assert.throws(
    () =>
      getProductPrismaWhere(
        [{ field: "unknown_field", operator: "equals", value: "x" }],
        "shop.myshopify.com",
      ),
    /Unsupported product filter field/,
  );
});
