import { parentPort, workerData } from "node:worker_threads";
import { getUpdatedProducts } from "../../../helpers/productBulkOperationHelpers/productUpdateHandler.js";

function normalizePreparedProduct(rawProduct) {
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

function processChunk({
  products = [],
  rules = [],
  historyId,
  shop,
  batchId,
}) {
  const formattedProducts = [];
  const changes = [];

  for (const rawProduct of products) {
    const product = normalizePreparedProduct(rawProduct);

    for (const rule of rules) {
      const result = getUpdatedProducts({
        product,
        field: rule.field,
        editType: rule.editOption,
        value: rule.value,
        searchKey: rule.searchKey,
        replaceText: rule.replaceText,
        supportValue: rule.supportValue,
        changes,
        historyId,
        shop,
        batchId,
      });

      if (result) {
        formattedProducts.push(result);
      }
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
      stack: error.stack,
    },
  });
}
