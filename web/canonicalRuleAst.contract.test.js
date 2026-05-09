import test from "node:test";
import assert from "node:assert/strict";

import { RULE_FIELD_OPERATOR_MATRIX } from "./services/ruleAst/canonicalRuleAst.constants.js";
import { compileCanonicalRuleAstToSql } from "./services/ruleAst/canonicalRuleAst.sqlCompiler.js";

function sampleValue(field, operator) {
  if (field === "metafield.value") {
    if (operator === "exists" || operator === "not_exists") {
      return { namespace: "custom", key: "season" };
    }
    if (operator === "between") {
      return { namespace: "custom", key: "rating", value: { from: 1, to: 5 } };
    }
    if (operator === "in" || operator === "not_in") {
      return { namespace: "custom", key: "season", value: ["summer", "winter"] };
    }
    return { namespace: "custom", key: "season", value: "summer" };
  }

  if (operator === "between") return { from: 1, to: 10 };
  if (operator === "in" || operator === "not_in") return ["A", "B"];
  if (operator === "is_empty" || operator === "is_not_empty") return "";
  if (["gt", "gte", "lt", "lte"].includes(operator)) return 5;
  if (field.includes("At")) return "2026-01-01T00:00:00.000Z";
  if (field.includes("Inventory") || field.includes("price")) return 10;
  return "sample";
}

test("every RULE_FIELD_OPERATOR_MATRIX pair compiles or returns intentional blocked code", () => {
  const blockedCodes = new Set([
    "CANONICAL_RULE_AST_INVALID",
    "CANONICAL_SQL_FIELD_UNSUPPORTED",
    "CANONICAL_SQL_OPERATOR_UNSUPPORTED",
    "CANONICAL_SQL_METAFIELD_SCOPE_REQUIRED",
  ]);

  for (const [field, operators] of Object.entries(RULE_FIELD_OPERATOR_MATRIX)) {
    for (const operator of operators) {
      const ast = {
        type: "condition",
        field,
        operator,
        value: sampleValue(field, operator),
      };

      try {
        const compiled = compileCanonicalRuleAstToSql({
          ast,
          shop: "shop.myshopify.com",
          catalogBatchId: "batch_1",
          resourceScope: "MIXED",
        });
        assert.ok(typeof compiled.sql === "string" && compiled.sql.includes("FROM \"Product\" p"));
        assert.ok(Array.isArray(compiled.params) && compiled.params.length >= 2);
      } catch (error) {
        assert.ok(
          blockedCodes.has(error?.code),
          `Unexpected error code for ${field}/${operator}: ${error?.code || error?.message}`,
        );
      }
    }
  }
});

test("invalid pair fails with canonical validation error", () => {
  assert.throws(
    () =>
      compileCanonicalRuleAstToSql({
        ast: {
          type: "condition",
          field: "product.status",
          operator: "contains",
          value: "ACTIVE",
        },
        shop: "shop.myshopify.com",
        catalogBatchId: "batch_1",
      }),
    (error) => error?.code === "CANONICAL_RULE_AST_INVALID",
  );
});
