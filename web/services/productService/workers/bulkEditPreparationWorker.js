import { parentPort, workerData } from "node:worker_threads";
import { compileProductBulkEdit } from "../../../helpers/productBulkOperationHelpers/productUpdateHandler.js";

function assertRequiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    const error = new Error(`${name}_REQUIRED`);
    error.code = `${name}_REQUIRED`;
    throw error;
  }

  return value.trim();
}

function normalizeRules(rules) {
  if (!Array.isArray(rules) || rules.length === 0) {
    const error = new Error("BULK_EDIT_RULES_REQUIRED");
    error.code = "BULK_EDIT_RULES_REQUIRED";
    throw error;
  }

  return rules.map((rule) => {
    if (!rule || typeof rule !== "object") {
      const error = new Error("INVALID_BULK_EDIT_RULE");
      error.code = "INVALID_BULK_EDIT_RULE";
      throw error;
    }

    if (typeof rule.field !== "string" || !rule.field.trim()) {
      const error = new Error("BULK_EDIT_RULE_FIELD_REQUIRED");
      error.code = "BULK_EDIT_RULE_FIELD_REQUIRED";
      throw error;
    }

    if (typeof rule.editOption !== "string" || !rule.editOption.trim()) {
      const error = new Error("BULK_EDIT_RULE_EDIT_OPTION_REQUIRED");
      error.code = "BULK_EDIT_RULE_EDIT_OPTION_REQUIRED";
      throw error;
    }

    return {
      ...rule,
      field: rule.field.trim(),
      editOption: rule.editOption.trim(),
    };
  });
}

function normalizeProducts(products) {
  if (!Array.isArray(products) || products.length === 0) {
    const error = new Error("BULK_EDIT_PRODUCTS_REQUIRED");
    error.code = "BULK_EDIT_PRODUCTS_REQUIRED";
    throw error;
  }

  return products;
}

function normalizePreparedProduct(rawProduct) {
  if (!rawProduct || typeof rawProduct !== "object") {
    const error = new Error("INVALID_BULK_EDIT_PRODUCT");
    error.code = "INVALID_BULK_EDIT_PRODUCT";
    throw error;
  }

  if (typeof rawProduct.id !== "string" || !rawProduct.id.trim()) {
    const error = new Error("BULK_EDIT_PRODUCT_ID_REQUIRED");
    error.code = "BULK_EDIT_PRODUCT_ID_REQUIRED";
    throw error;
  }

  return {
    ...rawProduct,
    descriptionHtml: rawProduct?.descriptionHtml ?? null,
    descriptionText: rawProduct?.descriptionText ?? null,
    description:
      rawProduct?.descriptionHtml ??
      rawProduct?.descriptionText ??
      "",
    options: Array.isArray(rawProduct?.options)
      ? rawProduct.options
      : Array.isArray(rawProduct?.optionsJson)
        ? rawProduct.optionsJson
        : [],
    variants: Array.isArray(rawProduct?.variants)
      ? rawProduct.variants.map((variant) => ({
          ...variant,
          selectedOptions: Array.isArray(variant?.selectedOptions)
            ? variant.selectedOptions
            : Array.isArray(variant?.selectedOptionsJson)
              ? variant.selectedOptionsJson
              : [],
        }))
      : [],
  };
}

function processChunk(payload) {
  const products = normalizeProducts(payload?.products);
  const rules = normalizeRules(payload?.rules);
  const historyId = assertRequiredString(payload?.historyId, "HISTORY_ID");
  const shop = assertRequiredString(payload?.shop, "SHOP");
  const batchId = assertRequiredString(payload?.batchId, "BATCH_ID");

  const formattedProducts = [];
  const changes = [];

  for (const rawProduct of products) {
    const product = normalizePreparedProduct(rawProduct);
    const result = compileProductBulkEdit({
      product,
      rules,
      historyId,
      shop,
      batchId,
    });

    if (result?.formattedProduct) {
      formattedProducts.push(result.formattedProduct);
    }
    if (result?.changeRecord) {
      changes.push(result.changeRecord);
    }
  }

  return {
    formattedProducts,
    changes,
  };
}

function postResult(payload) {
  parentPort?.postMessage(payload);
}

try {
  postResult({
    result: processChunk(workerData || {}),
  });
} catch (error) {
  postResult({
    error: {
      message: error.message,
      code: error.code || "BULK_EDIT_PREPARATION_WORKER_FAILED",
      stack: error.stack,
    },
  });
}
