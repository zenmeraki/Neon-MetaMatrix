import { parseProductSnippetCode } from "../modules/productCodeSnippets/productSnippetParser.js";
import crypto from "crypto";
import {
  getSnippetInputFieldDefinition,
  getSnippetOutputFieldDefinition,
  listSnippetInputFields,
  listSnippetOutputFields,
  normalizeSnippetOutput,
  SUPPORTED_SNIPPET_OPERATORS,
} from "../modules/productCodeSnippets/productSnippetSchema.js";
import { stableCanonicalStringify } from "../utils/stableCanonicalStringify.js";

const MAX_SNIPPET_CODE_BYTES = 16 * 1024;
const MAX_CONDITION_DEPTH = 8;
const MAX_CONDITION_NODES = 100;
const MAX_SNIPPET_TITLE_LENGTH = 80;
const MAX_OUTPUT_TEXT_LENGTH = 1000;
const MAX_TAG_COUNT = 200;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const VALIDATOR_VERSION = 1;
const MAX_COMPLEXITY_SCORE = Number(
  process.env.MAX_SNIPPET_COMPLEXITY_SCORE || 400,
);

function codedError(code, message = code, meta = undefined) {
  const error = new Error(message);
  error.code = code;
  if (meta !== undefined) error.meta = meta;
  return error;
}

function assertSafeObjectKeys(node, path) {
  for (const key of Object.keys(node || {})) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw codedError("SNIPPET_FORBIDDEN_KEY", `${path}.${key} is not allowed`, { path, key });
    }
  }
}

function sortObjectKeys(value) {
  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      acc[key] = value[key];
      return acc;
    }, {});
}

function canonicalConditionHash(value) {
  return stableCanonicalStringify(value);
}

function canonicalizePrimitive(value) {
  if (typeof value === "string") {
    return value.normalize("NFC");
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizePrimitive);
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalizePrimitive(value[key]);
        return acc;
      }, {});
  }
  if (Number.isNaN(value)) return null;
  if (value === Infinity || value === -Infinity) return null;
  return value;
}

function scoreConditionAst(node) {
  if (!node || typeof node !== "object") return 0;
  if (Array.isArray(node.all)) {
    return 1 + node.all.reduce((acc, child) => acc + scoreConditionAst(child), 0) + node.all.length;
  }
  if (Array.isArray(node.any)) {
    return 1 + node.any.reduce((acc, child) => acc + scoreConditionAst(child), 0) + node.any.length * 2;
  }
  if (Object.prototype.hasOwnProperty.call(node, "not")) {
    return 2 + scoreConditionAst(node.not);
  }
  return 3;
}

function dedupeConditionNode(node) {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node.all)) {
    const deduped = [];
    const seen = new Set();
    for (const child of node.all.map(dedupeConditionNode)) {
      const key = stableCanonicalStringify(child);
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(child);
      }
    }
    return { all: deduped };
  }
  if (Array.isArray(node.any)) {
    const deduped = [];
    const seen = new Set();
    for (const child of node.any.map(dedupeConditionNode)) {
      const key = stableCanonicalStringify(child);
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(child);
      }
    }
    return { any: deduped };
  }
  if (Object.prototype.hasOwnProperty.call(node, "not")) {
    return { not: dedupeConditionNode(node.not) };
  }
  return node;
}

function detectSimpleContradictions(node) {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node.all)) {
    const leafMap = new Map();
    for (const child of node.all) {
      if (child?.field && child?.op && Object.prototype.hasOwnProperty.call(child, "value")) {
        const key = `${child.field}:${stableCanonicalStringify(child.value)}`;
        const prior = leafMap.get(key);
        if (
          (prior === "equals" && child.op === "notEquals") ||
          (prior === "notEquals" && child.op === "equals")
        ) {
          return true;
        }
        if (!prior) leafMap.set(key, child.op);
      }
    }
    return node.all.some(detectSimpleContradictions);
  }
  if (Array.isArray(node.any)) {
    return node.any.some(detectSimpleContradictions);
  }
  if (Object.prototype.hasOwnProperty.call(node, "not")) {
    return detectSimpleContradictions(node.not);
  }
  return false;
}

function detectAlwaysTrue(node) {
  if (!node || typeof node !== "object") return true;
  if (Array.isArray(node.any) && node.any.length === 0) return false;
  if (Array.isArray(node.all)) {
    if (node.all.length === 0) return true;
    return node.all.every(detectAlwaysTrue);
  }
  if (Array.isArray(node.any)) {
    return node.any.some(detectAlwaysTrue);
  }
  if (Object.prototype.hasOwnProperty.call(node, "not")) {
    return false;
  }
  return false;
}

function computeSemanticSignals(ast) {
  const warnings = [];
  const when = ast?.when || null;
  if (when && detectSimpleContradictions(when)) {
    warnings.push({ code: "SNIPPET_CONDITION_CONTRADICTION", severity: "medium" });
  }
  if (when && detectAlwaysTrue(when) && ast?.else && Object.keys(ast.else).length > 0) {
    warnings.push({ code: "SNIPPET_ELSE_UNREACHABLE", severity: "low" });
  }
  const thenOps = Object.keys(ast?.then || {});
  const isNoOp = thenOps.length === 0;
  if (isNoOp) {
    warnings.push({ code: "SNIPPET_NO_OP", severity: "medium" });
  }
  return { isNoOp, warnings };
}

function classifyOutputSafety(output = {}) {
  const fields = Object.keys(output);
  return {
    affectsPricing: fields.includes("price") || fields.includes("compareAtPrice"),
    affectsInventory: fields.includes("inventoryPolicy"),
    affectsSEO:
      fields.includes("metaTitle") ||
      fields.includes("metaDescription") ||
      fields.includes("handle"),
    destructivePotential:
      fields.includes("status") ||
      fields.includes("handle") ||
      fields.includes("tags"),
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }
  return value;
}

function validateSnippetConditionValue({ field, fieldConfig, op, value, path }) {
  const scalarType = String(fieldConfig.type || "").replace(/\[]$/, "");
  const isSetOp = op === "in" || op === "notIn";
  if (isSetOp) {
    if (!Array.isArray(value) || !value.length) {
      throw codedError("SNIPPET_CONDITION_INVALID_VALUE", `${path}.value must be a non-empty array`);
    }
    return;
  }

  if (["exists", "isEmpty"].includes(op)) return;

  if (scalarType === "number" && !Number.isFinite(Number(value))) {
    throw codedError("SNIPPET_CONDITION_INVALID_VALUE", `${path}.value must be numeric`, {
      field,
      op,
    });
  }
  if (scalarType === "boolean" && typeof value !== "boolean") {
    throw codedError("SNIPPET_CONDITION_INVALID_VALUE", `${path}.value must be boolean`, {
      field,
      op,
    });
  }
  if (scalarType === "string") {
    if (typeof value !== "string" && !Array.isArray(value)) {
      throw codedError("SNIPPET_CONDITION_INVALID_VALUE", `${path}.value must be string`, {
        field,
        op,
      });
    }
  }
}

function validateConditionNode(
  node,
  path = "when",
  context = { count: 0, depth: 0 },
) {
  context.count += 1;
  if (context.count > MAX_CONDITION_NODES) {
    throw codedError("SNIPPET_CONDITION_TOO_COMPLEX");
  }
  if (context.depth > MAX_CONDITION_DEPTH) {
    throw codedError("SNIPPET_CONDITION_TOO_DEEP");
  }
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw codedError("SNIPPET_CONDITION_INVALID_NODE", `${path} must be an object`);
  }
  assertSafeObjectKeys(node, path);

  const hasAll = Array.isArray(node.all);
  const hasAny = Array.isArray(node.any);
  const hasNot = Object.prototype.hasOwnProperty.call(node, "not");
  const hasLeaf =
    Object.prototype.hasOwnProperty.call(node, "field") ||
    Object.prototype.hasOwnProperty.call(node, "op");
  const shapeCount = [hasAll, hasAny, hasNot, hasLeaf].filter(Boolean).length;

  if (shapeCount !== 1) {
    throw codedError(
      "SNIPPET_CONDITION_INVALID_SHAPE",
      `${path} must define exactly one of all, any, not, or a field comparison`,
    );
  }

  if (hasAll) {
    if (!node.all.length) {
      throw codedError("SNIPPET_CONDITION_EMPTY_ALL", `${path}.all must contain at least one rule`);
    }
    const nextContext = { count: context.count, depth: context.depth + 1 };
    const children = node.all.map((child, index) =>
      validateConditionNode(child, `${path}.all[${index}]`, nextContext),
    );
    context.count = nextContext.count;
    return {
      all: children.sort((a, b) =>
        canonicalConditionHash(a).localeCompare(canonicalConditionHash(b)),
      ),
    };
  }

  if (hasAny) {
    if (!node.any.length) {
      throw codedError("SNIPPET_CONDITION_EMPTY_ANY", `${path}.any must contain at least one rule`);
    }
    const nextContext = { count: context.count, depth: context.depth + 1 };
    const children = node.any.map((child, index) =>
      validateConditionNode(child, `${path}.any[${index}]`, nextContext),
    );
    context.count = nextContext.count;
    return {
      any: children.sort((a, b) =>
        canonicalConditionHash(a).localeCompare(canonicalConditionHash(b)),
      ),
    };
  }

  if (hasNot) {
    const nextContext = { count: context.count, depth: context.depth + 1 };
    const normalizedNot = validateConditionNode(node.not, `${path}.not`, nextContext);
    context.count = nextContext.count;
    return {
      not: normalizedNot,
    };
  }

  if (node.field === undefined) {
    throw codedError("SNIPPET_CONDITION_FIELD_REQUIRED", `${path}.field is required`);
  }
  if (node.op === undefined) {
    throw codedError("SNIPPET_CONDITION_OPERATOR_REQUIRED", `${path}.op is required`);
  }

  const field = String(node.field || "").trim();
  const op = String(node.op || "").trim();
  if (!field) {
    throw codedError("SNIPPET_CONDITION_FIELD_REQUIRED", `${path}.field is required`);
  }
  if (!op) {
    throw codedError("SNIPPET_CONDITION_OPERATOR_REQUIRED", `${path}.op is required`);
  }
  const fieldConfig = getSnippetInputFieldDefinition(field);

  if (!fieldConfig) {
    throw codedError("UNSUPPORTED_SNIPPET_CONDITION_FIELD", "Unsupported condition field", {
      field,
    });
  }

  if (!SUPPORTED_SNIPPET_OPERATORS.includes(op)) {
    throw codedError("UNSUPPORTED_SNIPPET_OPERATOR", "Unsupported operator", { op });
  }

  if (!["exists", "isEmpty"].includes(op) && node.value === undefined) {
    throw codedError("SNIPPET_CONDITION_VALUE_REQUIRED", `${path}.value is required for operator ${op}`);
  }
  validateSnippetConditionValue({
    field,
    fieldConfig,
    op,
    value: node.value,
    path,
  });

  return {
    field,
    op,
    ...(node.value !== undefined ? { value: canonicalizePrimitive(node.value) } : {}),
  };
}

function validateBranchOutput(branch, branchName) {
  if (branch === undefined) {
    return {};
  }

  if (!branch || typeof branch !== "object" || Array.isArray(branch)) {
    throw codedError("SNIPPET_OUTPUT_INVALID_BRANCH", `${branchName} must be an object`);
  }
  assertSafeObjectKeys(branch, branchName);

  if (branchName === "then" && !Object.keys(branch).length) {
    throw codedError("SNIPPET_THEN_REQUIRED", "then must contain at least one output field");
  }
  if (branchName === "else" && Object.keys(branch).length === 0) {
    return {};
  }

  for (const field of Object.keys(branch)) {
    if (FORBIDDEN_KEYS.has(field)) {
      throw codedError("SNIPPET_FORBIDDEN_OUTPUT_FIELD", `Forbidden output field key: ${field}`);
    }
    if (!getSnippetOutputFieldDefinition(field)) {
      throw codedError("UNSUPPORTED_SNIPPET_OUTPUT_FIELD", "Unsupported output field", { field });
    }
  }

  const normalized = normalizeSnippetOutput(branch);
  for (const [field, operation] of Object.entries(normalized)) {
    const value = operation?.set ?? operation?.add ?? operation?.remove;
    if (typeof value === "string" && value.length > MAX_OUTPUT_TEXT_LENGTH) {
      throw codedError("SNIPPET_OUTPUT_VALUE_TOO_LONG", `${field} exceeds max length`);
    }
    if ((field === "tags") && Array.isArray(value) && value.length > MAX_TAG_COUNT) {
      throw codedError("SNIPPET_OUTPUT_TOO_MANY_TAGS");
    }
  }
  return canonicalizePrimitive(sortObjectKeys(normalized));
}

export function validateProductSnippetDefinition({ title, code }) {
  const normalizedTitle = String(title || "").trim().normalize("NFC");
  if (!normalizedTitle) {
    throw codedError("SNIPPET_TITLE_REQUIRED");
  }
  if (normalizedTitle.length > MAX_SNIPPET_TITLE_LENGTH) {
    throw codedError("SNIPPET_TITLE_TOO_LONG");
  }
  if (/[\u0000-\u001F\u007F]/.test(normalizedTitle)) {
    throw codedError("SNIPPET_TITLE_INVALID");
  }
  const codeText = String(code || "");
  if (Buffer.byteLength(codeText, "utf8") > MAX_SNIPPET_CODE_BYTES) {
    throw codedError("SNIPPET_CODE_TOO_LARGE");
  }

  let ast;
  try {
    ast = parseProductSnippetCode(codeText);
  } catch (error) {
    const wrapped = codedError("SNIPPET_PARSE_FAILED");
    wrapped.cause = error;
    throw wrapped;
  }

  if (!ast.then || typeof ast.then !== "object" || Array.isArray(ast.then)) {
    throw codedError("SNIPPET_THEN_REQUIRED", "Snippet must include a then object");
  }

  const normalizedAst = canonicalizePrimitive({
    ...(ast.when
      ? {
          when: validateConditionNode(ast.when, "when", { count: 0, depth: 0 }),
        }
      : {}),
    then: validateBranchOutput(ast.then, "then"),
    ...(ast.else !== undefined ? { else: validateBranchOutput(ast.else, "else") } : {}),
  });
  if (normalizedAst.when) {
    normalizedAst.when = dedupeConditionNode(normalizedAst.when);
  }

  const complexityScore = scoreConditionAst(normalizedAst.when || null);
  if (complexityScore > MAX_COMPLEXITY_SCORE) {
    throw codedError("SNIPPET_COMPLEXITY_TOO_HIGH");
  }

  const fingerprint = crypto
    .createHash("sha256")
    .update(stableCanonicalStringify(normalizedAst))
    .digest("hex");
  const safetyMetadata = classifyOutputSafety(normalizedAst.then);
  const semantic = computeSemanticSignals(normalizedAst);

  const hasWrites = Object.keys(normalizedAst.then || {}).length > 0;
  const safetyClass = hasWrites ? "SAFE_WRITE" : "READ_ONLY";
  const frozenAst = deepFreeze(normalizedAst);

  return {
    ast: frozenAst,
    validationStatus: "VALID",
    fingerprint,
    complexityScore,
    estimatedExecutionCost: complexityScore,
    isNoOp: semantic.isNoOp,
    warnings: semantic.warnings,
    safetyClass,
    ...safetyMetadata,
    requiredPreview: true,
    schemaVersion: 1,
    validatorVersion: VALIDATOR_VERSION,
  };
}
