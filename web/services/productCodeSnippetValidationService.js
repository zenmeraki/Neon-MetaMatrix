import { parseProductSnippetCode } from "../modules/productCodeSnippets/productSnippetParser.js";
import {
  getSnippetInputFieldDefinition,
  getSnippetOutputFieldDefinition,
  listSnippetInputFields,
  listSnippetOutputFields,
  normalizeSnippetOutput,
  SUPPORTED_SNIPPET_OPERATORS,
} from "../modules/productCodeSnippets/productSnippetSchema.js";

function validateConditionNode(node, path = "when") {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new Error(`${path} must be an object`);
  }

  const hasAll = Array.isArray(node.all);
  const hasAny = Array.isArray(node.any);
  const hasNot = Boolean(node.not);
  const hasLeaf = Boolean(node.field || node.op);
  const shapeCount = [hasAll, hasAny, hasNot, hasLeaf].filter(Boolean).length;

  if (shapeCount !== 1) {
    throw new Error(`${path} must define exactly one of all, any, not, or a field comparison`);
  }

  if (hasAll) {
    if (!node.all.length) {
      throw new Error(`${path}.all must contain at least one rule`);
    }
    node.all.forEach((child, index) => validateConditionNode(child, `${path}.all[${index}]`));
    return {
      all: node.all.map((child) => validateConditionNode(child)),
    };
  }

  if (hasAny) {
    if (!node.any.length) {
      throw new Error(`${path}.any must contain at least one rule`);
    }
    node.any.forEach((child, index) => validateConditionNode(child, `${path}.any[${index}]`));
    return {
      any: node.any.map((child) => validateConditionNode(child)),
    };
  }

  if (hasNot) {
    return {
      not: validateConditionNode(node.not, `${path}.not`),
    };
  }

  const field = String(node.field || "").trim();
  const op = String(node.op || "").trim();
  const fieldConfig = getSnippetInputFieldDefinition(field);

  if (!fieldConfig) {
    throw new Error(
      `Unsupported condition field: ${field}. Supported fields: ${listSnippetInputFields().join(", ")}`,
    );
  }

  if (!SUPPORTED_SNIPPET_OPERATORS.includes(op)) {
    throw new Error(
      `Unsupported operator: ${op}. Supported operators: ${SUPPORTED_SNIPPET_OPERATORS.join(", ")}`,
    );
  }

  if (!["exists", "isEmpty"].includes(op) && node.value === undefined) {
    throw new Error(`${path}.value is required for operator ${op}`);
  }

  return {
    field,
    op,
    ...(node.value !== undefined ? { value: node.value } : {}),
  };
}

function validateBranchOutput(branch, branchName) {
  if (branch === undefined) {
    return {};
  }

  if (!branch || typeof branch !== "object" || Array.isArray(branch)) {
    throw new Error(`${branchName} must be an object`);
  }

  if (branchName === "then" && !Object.keys(branch).length) {
    throw new Error("then must contain at least one output field");
  }

  for (const field of Object.keys(branch)) {
    if (!getSnippetOutputFieldDefinition(field)) {
      throw new Error(
        `Unsupported output field: ${field}. Supported output fields: ${listSnippetOutputFields().join(", ")}`,
      );
    }
  }

  return normalizeSnippetOutput(branch);
}

export function validateProductSnippetDefinition({ title, code }) {
  if (!String(title || "").trim()) {
    throw new Error("Snippet title is required");
  }

  const ast = parseProductSnippetCode(code);

  if (!ast.then || typeof ast.then !== "object" || Array.isArray(ast.then)) {
    throw new Error("Snippet must include a then object");
  }

  const normalizedAst = {
    ...(ast.when ? { when: validateConditionNode(ast.when) } : {}),
    then: validateBranchOutput(ast.then, "then"),
    ...(ast.else !== undefined ? { else: validateBranchOutput(ast.else, "else") } : {}),
  };

  return {
    ast: normalizedAst,
    validationStatus: "VALID",
  };
}
