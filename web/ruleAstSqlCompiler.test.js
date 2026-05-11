import assert from "node:assert/strict";
import test from "node:test";

import {
  AstCompileError,
  buildFreezeTargetSetQuery,
  buildProductSearchQuery,
  compileFilterAst,
  optimizeAst,
} from "./services/rules/astSqlCompiler.js";

const baseArgs = {
  shop: "shop.myshopify.com",
  catalogBatchId: "batch_1",
};

test("compiles registry-backed AST to snapshot-pinned parameterized SQL", () => {
  const ast = {
    type: "group",
    operator: "AND",
    children: [
      { type: "predicate", field: "status", operator: "EQ", value: "active" },
      { type: "predicate", field: "title", operator: "CONTAINS", value: "A_B%" },
    ],
  };

  const compiled = compileFilterAst({ ...baseArgs, ast });

  assert.match(compiled.whereSql, /p\.shop = \$1/);
  assert.match(compiled.whereSql, /p\."mirrorBatchId" = \$2/);
  assert.match(compiled.whereSql, /p\.title ILIKE \$4 ESCAPE '\\'/);
  assert.deepEqual(compiled.params, [
    "shop.myshopify.com",
    "batch_1",
    "active",
    "%A\\_B\\%%",
  ]);
});

test("variant predicates compile through EXISTS to avoid product duplication", () => {
  const compiled = compileFilterAst({
    ...baseArgs,
    ast: { type: "predicate", field: "variantSku", operator: "STARTS_WITH", value: "ABC" },
  });

  assert.match(compiled.whereSql, /EXISTS \(/);
  assert.match(compiled.whereSql, /FROM "Variant" v/);
  assert.match(compiled.whereSql, /v\."productId" = p\.id/);
  assert.deepEqual(compiled.params, ["shop.myshopify.com", "batch_1", "ABC%"]);
});

test("search query appends cursor and limit parameters in order", () => {
  const query = buildProductSearchQuery({
    ...baseArgs,
    ast: { type: "predicate", field: "status", operator: "EQ", value: "active" },
    cursorId: "gid://shopify/Product/1",
    limit: 25,
  });

  assert.match(query.sql, /AND p\.id > \$4/);
  assert.match(query.sql, /LIMIT \$5/);
  assert.deepEqual(query.params, [
    "shop.myshopify.com",
    "batch_1",
    "active",
    "gid://shopify/Product/1",
    25,
  ]);
});

test("freeze query targets current TargetSnapshotSet uniqueness contract", () => {
  const query = buildFreezeTargetSetQuery({
    ...baseArgs,
    operationId: "op_1",
    ast: { type: "predicate", field: "status", operator: "EQ", value: "active" },
  });

  assert.match(query.sql, /INSERT INTO "TargetSnapshotSet"/);
  assert.match(query.sql, /ON CONFLICT \("operationId", "entityId"\)/);
  assert.deepEqual(query.params, [
    "shop.myshopify.com",
    "batch_1",
    "active",
    "op_1",
  ]);
});

test("optimizer flattens matching groups and orders cheaper predicates first", () => {
  const optimized = optimizeAst({
    type: "group",
    operator: "AND",
    children: [
      { type: "predicate", field: "variantSku", operator: "CONTAINS", value: "ABC" },
      {
        type: "group",
        operator: "AND",
        children: [
          { type: "predicate", field: "tags", operator: "ARRAY_OVERLAP", value: ["sale"] },
          { type: "predicate", field: "status", operator: "EQ", value: "active" },
        ],
      },
    ],
  });

  assert.deepEqual(
    optimized.children.map((child) => child.field),
    ["status", "tags", "variantSku"],
  );
});

test("unknown fields fail closed", () => {
  assert.throws(
    () =>
      compileFilterAst({
        ...baseArgs,
        ast: { type: "predicate", field: "p.status; DROP TABLE", operator: "EQ", value: "x" },
      }),
    (error) => error instanceof AstCompileError && error.code === "UNKNOWN_FIELD",
  );
});
