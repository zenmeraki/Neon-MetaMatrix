import assert from "node:assert/strict";
import test from "node:test";
import {
  clearCompiledFilterCache,
  compileFilterExecutor,
  getCompiledFilterCacheStats,
} from "./services/filterPlanner/compiledFilterEngine.js";
import { buildQueryPlan } from "./services/filterPlanner/queryPlanner.js";

const AST = Object.freeze({
  type: "AND",
  children: [
    {
      type: "PREDICATE",
      field: "title",
      operator: "contains",
      value: "shirt",
    },
    {
      type: "PREDICATE",
      field: "sku",
      operator: "starts with",
      value: "SKU",
    },
  ],
});

test("compiled filter executor caches canonical filter compilation", () => {
  clearCompiledFilterCache();

  const first = compileFilterExecutor({
    ast: AST,
    shop: "unit-test.myshopify.com",
    mirrorBatchId: "batch_1",
    engine: "postgres",
    sort: { key: "ID", order: "asc", prismaField: "id" },
  });
  const second = compileFilterExecutor({
    sort: { prismaField: "id", order: "asc", key: "ID" },
    engine: "postgres",
    mirrorBatchId: "batch_1",
    shop: "unit-test.myshopify.com",
    ast: AST,
  });

  assert.equal(first.cacheStatus, "miss");
  assert.equal(second.cacheStatus, "hit");
  assert.equal(first.cacheKey, second.cacheKey);
  assert.equal(first.compiledFilterHash, second.compiledFilterHash);
  assert.equal(getCompiledFilterCacheStats().size, 1);
});

test("compiled filter exposes execution metadata", () => {
  const compiled = compileFilterExecutor({
    ast: AST,
    shop: "unit-test.myshopify.com",
    mirrorBatchId: "batch_1",
    engine: "postgres",
    sort: { key: "TITLE", order: "desc", prismaField: "title" },
  });

  assert.equal(compiled.whereClause.shop, "unit-test.myshopify.com");
  assert.equal(compiled.whereClause.mirrorBatchId, "batch_1");
  assert.equal(compiled.joinPlan.requiresVariantJoin, true);
  assert.equal(compiled.joinPlan.requiresCollectionJoin, false);
  assert.ok(compiled.requiredIndexes.some((entry) => entry.includes("VariantMirror")));
  assert.deepEqual(compiled.selectPlan.select, { id: true });
});

test("relative date filters are not cached because compiled dates are time-sensitive", () => {
  clearCompiledFilterCache();

  const relativeAst = {
    type: "AND",
    children: [
      {
        type: "PREDICATE",
        field: "createdAt",
        operator: "is before x days ago",
        value: 7,
      },
    ],
  };
  const first = compileFilterExecutor({
    ast: relativeAst,
    shop: "unit-test.myshopify.com",
    mirrorBatchId: "batch_1",
    engine: "postgres",
  });
  const second = compileFilterExecutor({
    ast: relativeAst,
    shop: "unit-test.myshopify.com",
    mirrorBatchId: "batch_1",
    engine: "postgres",
  });

  assert.equal(first.cacheStatus, "uncacheable");
  assert.equal(second.cacheStatus, "uncacheable");
  assert.equal(getCompiledFilterCacheStats().size, 0);
});

test("query planner attaches the compiled filter contract", () => {
  const plan = buildQueryPlan({
    filterParams: [{ field: "vendor", operator: "equals", value: "Acme" }],
    shop: "unit-test.myshopify.com",
    mirrorBatchId: "batch_1",
    estimatedTotalRows: 100,
    operation: "preview",
  });

  assert.equal(plan.engine, "postgres");
  assert.equal(plan.where, plan.compiledFilter.whereClause);
  assert.equal(plan.whereClause, plan.compiledFilter.whereClause);
  assert.ok(Array.isArray(plan.requiredIndexes));
  assert.equal(plan.selectPlan.model, "product");
});
