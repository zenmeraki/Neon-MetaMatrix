import {
  getSnippetInputFieldDefinition,
  normalizeSnippetOutput,
} from "./productSnippetSchema.js";

function toComparableValue(value) {
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }

  return value;
}

function evaluateComparison(values, operator, expectedValue) {
  const comparableExpected = Array.isArray(expectedValue)
    ? expectedValue.map(toComparableValue)
    : toComparableValue(expectedValue);
  const comparableExpectedList = Array.isArray(comparableExpected)
    ? comparableExpected
    : [comparableExpected];

  const comparableValues = values.map(toComparableValue);

  switch (operator) {
    case "equals":
      return comparableValues.some((value) => value === comparableExpected);
    case "notEquals":
      return comparableValues.every((value) => value !== comparableExpected);
    case "contains":
      return comparableValues.some((value) =>
        Array.isArray(value)
          ? value.map(toComparableValue).includes(comparableExpected)
          : String(value || "").includes(String(comparableExpected || "")),
      );
    case "notContains":
      return comparableValues.every((value) =>
        Array.isArray(value)
          ? !value.map(toComparableValue).includes(comparableExpected)
          : !String(value || "").includes(String(comparableExpected || "")),
      );
    case "greaterThan":
      return comparableValues.some((value) => Number(value) > Number(comparableExpected));
    case "greaterThanOrEqual":
      return comparableValues.some((value) => Number(value) >= Number(comparableExpected));
    case "lessThan":
      return comparableValues.some((value) => Number(value) < Number(comparableExpected));
    case "lessThanOrEqual":
      return comparableValues.some((value) => Number(value) <= Number(comparableExpected));
    case "in":
      return comparableValues.some((value) => comparableExpectedList.includes(value));
    case "notIn":
      return comparableValues.every((value) => !comparableExpectedList.includes(value));
    case "exists":
      return comparableValues.some((value) => value !== null && value !== undefined && value !== "");
    case "isEmpty":
      return comparableValues.every((value) =>
        value === null ||
        value === undefined ||
        value === "" ||
        (Array.isArray(value) && value.length === 0),
      );
    default:
      return false;
  }
}

function evaluateConditionNode(node, product) {
  if (!node) return true;

  if (Array.isArray(node.all)) {
    return node.all.every((child) => evaluateConditionNode(child, product));
  }

  if (Array.isArray(node.any)) {
    return node.any.some((child) => evaluateConditionNode(child, product));
  }

  if (node.not) {
    return !evaluateConditionNode(node.not, product);
  }

  const fieldConfig = getSnippetInputFieldDefinition(node.field);
  const values = fieldConfig.getValues(product);
  return evaluateComparison(values, node.op, node.value);
}

export function evaluateProductSnippet({ ast, product }) {
  const matched = ast.when ? evaluateConditionNode(ast.when, product) : true;
  const branch = matched ? ast.then || {} : ast.else || {};
  const normalizedOutput = normalizeSnippetOutput(branch);

  return {
    matched,
    normalizedOutput,
    branchUsed: matched ? "then" : "else",
  };
}
