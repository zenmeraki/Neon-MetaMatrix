import {
  FIELD_CONFIGS,
  TEXT_OPERATIONS,
  NUMERIC_OPERATIONS,
  TAG_OPERATIONS,
  COLLECTION_OPERATIONS,
} from "./constants.js";

function fail(code, message = code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function formatMoneyValue(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    fail("INVALID_NUMERIC_MUTATION_VALUE");
  }
  return num.toFixed(2);
}

function assertArray(value, code) {
  if (!Array.isArray(value)) {
    fail(code);
  }
  return value;
}

export const editProductField = ({
  product,
  field,
  editType,
  value,
  changes,
  isTracking,
  supportValue,
  returnTitleOnly,
  historyId,
  shop,
  batchId,
}) => {
  const config = FIELD_CONFIGS[field];
  if (!config) {
    fail("UNKNOWN_BULK_EDIT_FIELD", `Unknown field: ${field}`);
  }

  const plainValue = value;
  if (returnTitleOnly) {
    if (config?.optionPosition && config.isTextOperation) {
      const operation = TEXT_OPERATIONS[editType];
      return operation
        ? operation.getTitle(plainValue, config.displayName)
        : "";
    }

    if (config.customOnly) {
      if (config.fieldName === "category") {
        return `${config.displayName} updated to "${supportValue}"`;
      }
      return `${config.displayName} updated to "${plainValue}"`;
    }

    // Handle collections operations
    if (config.fieldName === "collections") {
      const operation = COLLECTION_OPERATIONS[editType];
      return operation ? operation.getTitle(supportValue || plainValue) : "";
    }

    if (config.isArray) {
      const operation = TAG_OPERATIONS[editType];
      return operation ? operation.getTitle(plainValue) : "";
    }

    const operations = config.isNumeric ? NUMERIC_OPERATIONS : TEXT_OPERATIONS;
    const operation = operations[editType];
    return operation
  ? operation.getTitle(plainValue, config.displayName)
  : "";
  }

  if (config?.optionPosition && config.isTextOperation) {
    const operation = TEXT_OPERATIONS[editType];

    if (field.includes("Name")) {
      return handleOptionNameField({
        product,
        config,
        operation,
        value: plainValue,
        changes,
        isTracking,
        historyId,
        shop,
        batchId,
      });
    }

    if (field.includes("Values")) {
      if (editType == "Set text to value" && product?.options?.length > 1) {
        return null;
      }
      return handleOptionValueField({
        product,
        config,
        operation,
        value: plainValue,
        changes,
        isTracking,
        historyId,
        shop,
        batchId,
      });
    }
  }

  if (config.customOnly) {
    if (config.isVariantLevel) {
      return handleVariantCustomField(
        product,
        config,
        plainValue,
        changes,
        supportValue,
        isTracking,
        historyId,
        shop,
        batchId
      );
    }

    return handleProductCustomField(
      product,
      config,
      plainValue,
      changes,
      supportValue,
      isTracking,
      historyId,
      shop,
      batchId
    );
  }

  // Handle collections field
  if (config.fieldName === "collections") {
    const operation = COLLECTION_OPERATIONS[editType];
    if (!operation) {
      fail("UNKNOWN_BULK_EDIT_OPERATION", `Unknown operation: ${editType} for field ${field}`);
    }

    return handleCollectionField(
      product,
      config,
      operation,
      value,
      supportValue,
      changes,
      isTracking,
      historyId,
      shop,
      batchId
    );
  }

  if (config.isArray) {
    const operation = TAG_OPERATIONS[editType];
    if (!operation) {
      fail("UNKNOWN_BULK_EDIT_OPERATION", `Unknown operation: ${editType} for field ${field}`);
    }

    return handleTagField(
      product,
      config,
      operation,
      value,
      changes,
      isTracking,
      historyId,
      shop,
      batchId
    );
  }

  const operations = config.isNumeric ? NUMERIC_OPERATIONS : TEXT_OPERATIONS;
  const operation = operations[editType];
  if (!operation) {
    fail("UNKNOWN_BULK_EDIT_OPERATION", `Unknown operation: ${editType} for field ${field}`);
  }

  if (config.isVariantLevel) {
    return handleVariantField(
      product,
      config,
      operation,
      plainValue,
      changes,
      isTracking,
      historyId,
      shop,
      batchId
    );
  } else {
    return handleProductField(
      product,
      config,
      operation,
      plainValue,
      changes,
      isTracking,
      historyId,
      shop,
      batchId
    );
  }
};

export const deleteProductField = ({
  product,
  config,
  changes,
  isTracking,
  historyId,
  shop,
  batchId,
}) => {

  if (isTracking) {

    return {
      productId: product.id || product._id, // Support both
      title: product.title,
      img: getProductImage(product),
      oldValue: "Exists",
      newValue: "Deleted",
    };
  }
  const productId = product.id || product._id;
  changes.push({
    editHistoryId: historyId,
    productId: productId,
    shop,
    image: getProductImage(product),
    title: product.title,
    scope: "product",
    batchId,
    productFieldChanges: [
      {
        field: config.fieldName,
        newValue: "Deleted",
        oldValue: "Exists",
      },
    ],
    status: "pending",
  });

  return JSON.stringify({
    id: productId,
  });
};

function handleCollectionField(
  product,
  config,
  operation,
  value,
  supportValue,
  changes,
  isTracking,
  historyId,
  shop,
  batchId
) {
  const productId = product.id || product._id;
  const currentCollections = config.getValue(product);
  const updatedCollections = operation.apply(
    currentCollections,
    value,
    supportValue
  );
  if (isTracking) {
    return {
      productId,
      title: product.title,
      img: getProductImage(product),
      oldValue: currentCollections.map((c) => c.title || c.id).join(", "),
      newValue: updatedCollections.titles || supportValue,
    };
  }

  changes.push({
    editHistoryId: historyId,
    productId,
    shop,
    image: getProductImage(product),
    title: product.title,
    scope: "product",
    batchId,
    productFieldChanges: [
      {
        field: "collections",
        oldValue: currentCollections.map((c) => c.title || c.id).join(", "),
        revertValue: currentCollections.map((c) => c.id),
        newValue: updatedCollections.titles || supportValue,
      },
    ],
    status: "pending",
  });

  return JSON.stringify({
    productSet: {
      id: productId,
      collections: updatedCollections.ids,
    },
  });
}

function handleProductField(
  product,
  config,
  operation,
  value,
  changes,
  isTracking,
  historyId,
  shop,
  batchId
) {
  if (isTracking) {
    const rawValue = config.getValue(product);
    const currentValue = config.needsProcessing
      ? config.getProcessedValue(product)
      : rawValue;
    const resolvedValue = resolveProductTemplateValue(value, product);
    const newValue = operation.apply(currentValue, resolvedValue);

    return {
      productId: product.id || product._id, // Support both
      title: product.title,
      img: getProductImage(product),
      oldValue: rawValue,
      newValue,
    };
  }

  const rawValue = config.getValue(product);
  const currentValue = config.needsProcessing
    ? config.getProcessedValue(product)
    : rawValue;
  const resolvedValue = resolveProductTemplateValue(value, product);
  const newValue = operation.apply(currentValue, resolvedValue);

  const productId = product.id || product._id;

  changes.push({
    editHistoryId: historyId,
    productId: productId,
    shop,
    image: getProductImage(product),
    title: product.title,
    scope: "product",
    batchId,
    productFieldChanges: [
      {
        field: config.fieldName,
        newValue: newValue,
        oldValue: rawValue,
      },
    ],
    status: "pending",
  });

  const payload = getMutationPayload(config.fieldName, newValue);

  return JSON.stringify({
    productSet: {
      id: productId,
      ...payload,
    },
  });
}

function resolveProductTemplateValue(value, product) {
  const replacements = {
    "{{title}}": product?.title || "",
    "{{vendor}}": product?.vendor || "",
    "{{handle}}": product?.handle || "",
    "{{productType}}": product?.productType || "",
  };

  if (typeof value === "string") {
    return Object.entries(replacements).reduce(
      (current, [token, replacement]) => current.split(token).join(replacement),
      value
    );
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        resolveProductTemplateValue(entryValue, product),
      ])
    );
  }

  return value;
}

function handleVariantField(
  product,
  config,
  operation,
  value,
  changes,
  isTracking,
  historyId,
  shop,
  batchId
) {
  const productId = product.id || product._id;
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const productOptions = assertArray(
    product?.options,
    "PRODUCT_OPTIONS_REQUIRED_FOR_VARIANT_MUTATION"
  );

  if (isTracking) {
    return {
      productId,
      title: product.title,
      img: getProductImage(product),
      variants: variants.map((variant) => {
        const currentValue = config.getValue(variant);
        const newValue = getNewVariantValue(
          variant,
          config,
          operation,
          value
        );

        const finalNewValue =
          config.isNumeric && typeof newValue === "number"
            ? formatMoneyValue(newValue)
            : newValue;

        return {
          id: variant.id || variant._id,
          title: variant.title || "Default",
          oldValue: currentValue,
          newValue: finalNewValue,
        };
      }),
    };
  }

  if (variants.length === 0) {
    return null;
  }

  changes.push({
    editHistoryId: historyId,
    productId,
    shop,
    image: getProductImage(product),
    title: product.title,
    scope: "variant",
    batchId,
    options: productOptions.map((op) => ({
      id: op.id,
      name: op.name,
      values: op.values,
    })),
    variantFieldChanges: variants.map((variant) => {
      const currentValue = config.getValue(variant);
      const newValue = getNewVariantValue(
        variant,
        config,
        operation,
        value
      );

      const formattedValue = config.isNumeric
        ? formatMoneyValue(newValue)
        : newValue;

      return {
        variantId: variant.id,
        variantTitle: variant.title,
        selectedOptions: assertArray(
          variant.selectedOptions,
          "VARIANT_SELECTED_OPTIONS_REQUIRED_FOR_VARIANT_MUTATION"
        ).map((op) => ({
          name: op.name,
          value: op.value,
        })),
        changes: [
          {
            field: config.fieldName,
            oldValue: currentValue,
            newValue: formattedValue,
          },
        ],
      };
    }),
    status: "pending",
  });

  return JSON.stringify({
    productSet: {
      id: productId,
      productOptions: productOptions.map((op) => ({
        name: op.name,
        values: (op.values ?? []).map((val) => ({ name: val })),
      })),
      variants: variants.map((variant) => {
        const newValue = getNewVariantValue(
          variant,
          config,
          operation,
          value
        );

        const formattedValue = config.isNumeric
          ? formatMoneyValue(newValue)
          : newValue;

        return {
          id: variant.id,
          optionValues: assertArray(
            variant.selectedOptions,
            "VARIANT_SELECTED_OPTIONS_REQUIRED_FOR_VARIANT_MUTATION"
          ).map((op) => ({
            optionName: op.name,
            name: op.value,
          })),
          [config.fieldName]: formattedValue,
        };
      }),
    },
  });
}

function handleProductCustomField(
  product,
  config,
  value,
  changes,
  supportValue,
  isTracking,
  historyId,
  shop,
  batchId
) {
  if (isTracking) {
    return {
      productId: product.id || product._id,
      title: product.title,
      img: getProductImage(product),
      oldValue: config.getValue(product),
      newValue: getNewValue(config.fieldName, value, supportValue),
    };
  }

  const productId = product.id || product._id;

  changes.push({
    editHistoryId: historyId,
    productId: productId,
    shop: shop,
    image: getProductImage(product),
    title: product.title,
    scope: "product",
    batchId,
    productFieldChanges: [
      {
        field: config.fieldName,
        newValue: getNewValue(config.fieldName, value, supportValue),
        oldValue: config.getValue(product),
        revertValue: config.getRevertValue
          ? config.getRevertValue(product)
          : config.getValue(product),
      },
    ],
    status: "pending",
  });

  return JSON.stringify({
    productSet: {
      id: productId,
      [config.fieldName]: value,
    },
  });
}

function handleVariantCustomField(
  product,
  config,
  value,
  changes,
  supportValue,
  isTracking,
  historyId,
  shop,
  batchId
) {
  const productId = product.id || product._id;
  const variants = product.variants || [];

  if (!variants.length) return null;

  // ===== TRACKING =====
  if (isTracking) {
    return {
      productId,
      title: product.title,
      img: getProductImage(product),
      variants: variants.map((variant) => {
        const oldValue = getOldValue(config.getValue(variant));
        const newValue = getNewValue(config.fieldName, value, supportValue);

        return {
          id: variant.id || variant._id,
          title: variant.title || "Default",
          oldValue,
          newValue: newValue,
        };
      }),
    };
  }

  // ===== HISTORY =====
  changes.push({
    editHistoryId: historyId,
    productId,
    shop,
    image: getProductImage(product),
    title: product.title,
    scope: "variant",
    batchId,
    options: product.options?.map((op) => ({
      id: op.id,
      name: op.name,
      values: op.values,
    })),
    variantFieldChanges: variants.map((variant) => {
      const oldValue = getOldValue(config.getValue(variant));
      const newValue = getNewValue(config.fieldName, value, supportValue);

      return {
        variantId: variant.id,
        variantTitle: variant.title,
        selectedOptions: variant.selectedOptions?.map((op) => ({
          name: op.name,
          value: op.value,
        })),
        changes: [
          {
            field: config.fieldName,
            oldValue,
            newValue,
            revertValue: config.getValue(variant),
          },
        ],
      };
    }),
    status: "pending",
  });

  // ===== SHOPIFY PAYLOAD =====
  return JSON.stringify({
    productSet: {
      id: productId,
      productOptions: product.options?.map((op) => ({
        name: op.name,
        values: op.values?.map((v) => ({ name: v })),
      })),
      variants: variants.map((variant) => ({
        id: variant.id,
        optionValues: variant.selectedOptions?.map((op) => ({
          optionName: op.name,
          name: op.value,
        })),
        [config.fieldName]: getPayloadNewValue(config.fieldName, value, supportValue),
      })),
    },
  });
}

function handleTagField(
  product,
  config,
  operation,
  value,
  changes,
  isTracking,
  historyId,
  shop,
  batchId
) {
  const productId = product.id || product._id;
  const currentTags = config.getValue(product);
  const updatedTags = operation.apply(currentTags, value);

  if (isTracking) {
    return {
      productId,
      title: product.title,
      img: getProductImage(product),
      oldValue: currentTags.join(", "),
      newValue: updatedTags.join(", "),
    };
  }

  changes.push({
    editHistoryId: historyId,
    productId,
    shop,
    image: getProductImage(product),
    title: product.title,
    scope: "product",
    batchId,
    productFieldChanges: [
      {
        field: "tags",
        oldValue: currentTags.join(", "),
        newValue: updatedTags.join(", "),
      },
    ],
    status: "pending",
  });

  return JSON.stringify({
    productSet: {
      id: productId,
      tags: updatedTags,
    },
  });
}

function handleOptionNameField({
  product,
  config,
  operation,
  value,
  changes,
  isTracking,
  historyId,
  shop,
  batchId,
}) {
  const productId = product.id || product._id;
  const position = config.optionPosition;

const option = product.options?.find((op) => op.position === position);

  if (!option) return null;

  const oldName = option.name;
  const newName = operation.apply(oldName, value);

  if (isTracking) {
    return {
      productId,
      title: product.title,
      img: getProductImage(product),
      oldValue: oldName,
      newValue: newName,
    };
  }

  const variants = Array.isArray(product?.variants) ? product.variants : [];

  changes.push({
    editHistoryId: historyId,
    productId,
    shop,
    image: getProductImage(product),
    title: product.title,
    scope: "product",
    batchId,
    options: product.options?.map((op) => ({
      id: op.id,
      name: op.name,
      values: op.values,
    })),
    productFieldChanges: [
      {
        field: config.fieldName,
        oldValue: oldName,
        revertValue: oldName,
        newValue: newName,
      },
    ],
    variantFieldChanges: variants.map((item) => {
      return {
        variantId: item.id,
        variantTitle: item.title,
        selectedOptions: item.selectedOptions?.map((op) => ({
          name: op.name,
          value: op.value,
        })),
        changes: [],
      };
    }),
    status: "pending",
  });

  return JSON.stringify({
  productSet: {
    id: productId,
    productOptions: product.options.map((op) => ({
      id: op.id,
      name: op.position === position ? newName : op.name,
      values: (op.values ?? []).map((v) => ({ name: v })),
    })),
    variants: variants.map((variant) => ({
      id: variant.id,
      optionValues: (variant.selectedOptions ?? []).map((op) => ({
        optionName: op.name === oldName ? newName : op.name,
        name: op.value,
      })),
    })),
  },
});
}

function handleOptionValueField({
  product,
  config,
  operation,
  value,
  changes,
  isTracking,
  historyId,
  shop,
  batchId,
}) {
  const productId = product.id || product._id;
  const position = config.optionPosition;

  const option = product.options?.find((op) => op.position === position);
  if (!option) return null;

  const variants = product.variants || [];

  /* =====================================================
     TRACKING (VARIANT LEVEL)
  ====================================================== */
  if (isTracking) {
    return {
      productId,
      title: product.title,
      img: getProductImage(product),
      variants: variants.map((variant) => {
        const selected = variant.selectedOptions?.find(
          (op) => op.name === option.name
        );

        const oldValue = selected?.value ?? null;
        const newValue =
          oldValue != null ? operation.apply(oldValue, value) : null;

        return {
          id: variant.id || variant._id,
          title: variant.title || "Default",
          oldValue,
          newValue,
        };
      }),
    };
  }

  /* =====================================================
     HISTORY (VARIANT LEVEL)
  ====================================================== */
  changes.push({
    editHistoryId: historyId,
    productId,
    shop,
    image: getProductImage(product),
    title: product.title,
    scope: "variant",
    batchId,
    options: product.options?.map((op) => ({
      id: op.id,
      name: op.name,
      values: op.values,
    })),
    variantFieldChanges: variants.map((variant) => {
      const selected = variant.selectedOptions?.find(
        (op) => op.name === option.name
      );

      const oldValue = selected?.value ?? null;
      const newValue =
        oldValue != null ? operation.apply(oldValue, value) : null;

      return {
        variantId: variant.id,
        variantTitle: variant.title,
        selectedOptions: variant.selectedOptions?.map((op) => ({
          name: op.name,
          value: op.value,
        })),
        changes: [
          {
            field: config.fieldName,
            oldValue,
            newValue,
          },
        ],
      };
    }),
    status: "pending",
  });

  /* =====================================================
     SHOPIFY PAYLOAD
  ====================================================== */
  const oldValues = option.values || [];
  const newValues = oldValues.map((v) => operation.apply(v, value));

  return JSON.stringify({
    productSet: {
      id: productId,

      /* PRODUCT OPTIONS */
      productOptions: product.options.map((op) => ({
        id: op.id,
        name: op.name,
        values:
          op.position === position
            ? newValues.map((v) => ({ name: v }))
            : op.values.map((v) => ({ name: v })),
      })),

      /* VARIANTS */
      variants: variants.map((variant) => ({
        id: variant.id,
        optionValues: variant.selectedOptions?.map((op) => {
          if (op.name === option.name) {
            return {
              optionName: op.name,
              name: operation.apply(op.value, value),
            };
          }

          return {
            optionName: op.name,
            name: op.value,
          };
        }),
      })),
    },
  });
}


export function getProductImage(product) {
  return product?.featuredMedia?.preview?.image?.url || product?.featuredImageUrl || "";
}

export const getUpdatedProducts = ({
  product,
  field,
  editType,
  value,
  changes = [],
  title = [],
  searchKey,
  replaceText,
  supportValue,
  isTracking = false,
  returnTitleOnly = false,
  historyId = null,
  shop = null,
  batchId = null,
  confirmedDangerousOperation = false,
  allowDirectExecution = false,
}) => {
  const isExecutionPath = !isTracking && !returnTitleOnly;
  if (isExecutionPath && allowDirectExecution !== true) {
    fail(
      "DIRECT_RULE_EXECUTION_PATH_DISABLED",
      "Direct rule execution path is disabled. Use compileBulkEditProductMutation.",
    );
  }

  if (!field) {
    fail("BULK_EDIT_FIELD_REQUIRED");
  }
  const config = FIELD_CONFIGS[field];
  if (!config) {
    fail("UNKNOWN_BULK_EDIT_FIELD", `Unknown field: ${field}`);
  }
  if (config?.isDanger) {
    if (!confirmedDangerousOperation && !isTracking && !returnTitleOnly) {
      fail("DANGEROUS_OPERATION_CONFIRMATION_REQUIRED");
    }
    if (returnTitleOnly) {
      return "Deleted products";
    }
    return deleteProductField({
      product,
      config,
      changes,
      isTracking,
      historyId,
      shop,
      batchId,
    });
  }
  let normalizedValue = value;
  if (!config?.customOnly) {
    normalizedValue = normalizeValue(editType, searchKey, replaceText, value);
  }
  return editProductField({
    product,
    field,
    editType,
    value: normalizedValue,
    changes,
    title,
    supportValue,
    isTracking,
    returnTitleOnly,
    historyId,
    shop,
    batchId,
  });
};

function normalizeValue(type, searchKey, replaceText, value) {
  const validOps = [
    "Search/Replace",
    "Rename tag",
    "Search/replace within tag name",
  ];
  return validOps.includes(type)
    ? { searchKey: searchKey || "", text: replaceText || "" }
    : value;
}

function getNewValue(fieldName, value, supportValue) {
  const fieldMap = {
    category: supportValue,

    status: value,

    taxable: value === "true" ? true : value === "false" ? false : value,
    inventoryPolicy: value == "CONTINUE" ? "Continue selling when out of stock" : "Don't continue selling when out of stock",
  };

  return fieldMap[fieldName] ?? value;
}

function getPayloadNewValue(fieldName, value, supportValue) {
  const fieldMap = {
    category: supportValue,

    status: value,

    taxable: value === "true" ? true : value === "false" ? false : value,
    inventoryPolicy: value,
  };

  return fieldMap[fieldName] ?? value;
}

function getOldValue(fieldValue) {
  const fieldMap = {
    CONTINUE: "Continue selling when out of stock",
    DENY: "Don't continue selling when out of stock"
  };

  return fieldMap[fieldValue] ?? fieldValue;
}

function getMutationPayload(fieldName, newValue) {
  const fieldMap = {
    "seo.title": { seo: { title: newValue } },
    "seo.description": { seo: { description: newValue } },
  };

  return fieldMap[fieldName] ?? { [fieldName]: newValue };
}

function getNewVariantValue(variant, config, operation, value) {
  const currentValue = config.getValue(variant);

  if (operation.isDepends) {
    const dependsValue = variant[operation.dependsOn];
    return operation.apply(dependsValue, value);
  }

  return operation.apply(currentValue, value);
}

export const getFieldConfig = (field) => FIELD_CONFIGS[field];
export const getAllFieldConfigs = () => FIELD_CONFIGS;
export const isVariantLevelField = (field) =>
  FIELD_CONFIGS[field]?.isVariantLevel || false;

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeRuleForCompile(rule) {
  if (!rule || typeof rule !== "object") {
    fail("INVALID_BULK_EDIT_RULE");
  }

  if (typeof rule.field !== "string" || !rule.field.trim()) {
    fail("BULK_EDIT_RULE_FIELD_REQUIRED");
  }

  if (typeof rule.editOption !== "string" || !rule.editOption.trim()) {
    fail("BULK_EDIT_RULE_EDIT_OPTION_REQUIRED");
  }

  return {
    ...rule,
    field: rule.field.trim(),
    editOption: rule.editOption.trim(),
  };
}

function mergeById(existing = [], incoming = [], keyResolver) {
  const map = new Map();

  for (const item of existing) {
    const key = keyResolver(item);
    if (key) map.set(key, item);
  }

  for (const item of incoming) {
    const key = keyResolver(item);
    if (!key) continue;
    const prev = map.get(key);
    map.set(key, prev ? deepMergeMutationPayload(prev, item) : item);
  }

  return Array.from(map.values());
}

function deepMergeMutationPayload(base, next) {
  if (!base || typeof base !== "object") return next;
  if (!next || typeof next !== "object") return base;

  const merged = { ...base };

  for (const [key, value] of Object.entries(next)) {
    if (key === "id") {
      merged.id = value ?? merged.id;
      continue;
    }

    if (key === "variants" && Array.isArray(value)) {
      const current = Array.isArray(merged.variants) ? merged.variants : [];
      merged.variants = mergeById(current, value, (item) => item?.id);
      continue;
    }

    if (key === "productOptions" && Array.isArray(value)) {
      const current = Array.isArray(merged.productOptions)
        ? merged.productOptions
        : [];
      merged.productOptions = mergeById(current, value, (item) => item?.id || item?.name);
      continue;
    }

    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      merged[key] &&
      typeof merged[key] === "object" &&
      !Array.isArray(merged[key])
    ) {
      merged[key] = deepMergeMutationPayload(merged[key], value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

function normalizeFieldValue(value) {
  if (typeof value === "number") return Number(value.toFixed(6));
  return value;
}

function applyProductSetToDraftProduct(draftProduct, productSet) {
  if (!draftProduct || !productSet || typeof productSet !== "object") {
    return;
  }

  for (const [key, value] of Object.entries(productSet)) {
    if (key === "id") continue;

    if (key === "seo" && value && typeof value === "object") {
      draftProduct.seo = {
        ...(draftProduct.seo || {}),
        ...value,
      };
      continue;
    }

    if (key === "productOptions" && Array.isArray(value)) {
      const currentOptions = Array.isArray(draftProduct.options)
        ? draftProduct.options
        : [];
      const byIdOrName = new Map(
        currentOptions.map((option, index) => [
          option?.id || `${option?.name || "option"}:${index}`,
          option,
        ])
      );

      for (const incoming of value) {
        const optKey =
          incoming?.id ||
          Array.from(byIdOrName.keys()).find((candidate) => {
            const item = byIdOrName.get(candidate);
            return item?.name === incoming?.name;
          });
        if (!optKey) continue;
        const existing = byIdOrName.get(optKey) || {};
        byIdOrName.set(optKey, {
          ...existing,
          ...incoming,
          values: Array.isArray(incoming?.values)
            ? incoming.values.map((entry) => entry?.name).filter(Boolean)
            : existing.values,
        });
      }

      draftProduct.options = Array.from(byIdOrName.values());
      continue;
    }

    if (key === "variants" && Array.isArray(value)) {
      const currentVariants = Array.isArray(draftProduct.variants)
        ? draftProduct.variants
        : [];
      const variantById = new Map(
        currentVariants.map((variant) => [variant?.id, variant])
      );

      for (const incomingVariant of value) {
        const variantId = incomingVariant?.id;
        if (!variantId) continue;
        const existingVariant = variantById.get(variantId) || { id: variantId };
        const nextVariant = {
          ...existingVariant,
          ...incomingVariant,
        };

        if (Array.isArray(incomingVariant?.optionValues)) {
          nextVariant.selectedOptions = incomingVariant.optionValues.map((option) => ({
            name: option?.optionName,
            value: option?.name,
          }));
        }

        delete nextVariant.optionValues;
        variantById.set(variantId, nextVariant);
      }

      draftProduct.variants = Array.from(variantById.values());
      continue;
    }

    draftProduct[key] = value;
  }
}

function buildAggregatedChangeRecord({
  product,
  historyId,
  shop,
  batchId,
  rawChanges,
}) {
  const productFields = new Map();
  const variants = new Map();

  for (const change of rawChanges) {
    for (const fieldChange of Array.isArray(change?.productFieldChanges)
      ? change.productFieldChanges
      : []) {
      if (!fieldChange?.field) continue;
      const prev = productFields.get(fieldChange.field);
      if (!prev) {
        productFields.set(fieldChange.field, cloneValue(fieldChange));
      } else {
        prev.newValue = cloneValue(fieldChange.newValue);
      }
    }

    for (const variantChange of Array.isArray(change?.variantFieldChanges)
      ? change.variantFieldChanges
      : []) {
      const variantId = variantChange?.variantId;
      if (!variantId) continue;

      const variantEntry = variants.get(variantId) || {
        variantId,
        variantTitle: variantChange.variantTitle || null,
        selectedOptions: cloneValue(variantChange.selectedOptions || []),
        changesByField: new Map(),
      };

      for (const fieldChange of Array.isArray(variantChange.changes)
        ? variantChange.changes
        : []) {
        if (!fieldChange?.field) continue;
        const prev = variantEntry.changesByField.get(fieldChange.field);
        if (!prev) {
          variantEntry.changesByField.set(fieldChange.field, cloneValue(fieldChange));
        } else {
          prev.newValue = cloneValue(fieldChange.newValue);
        }
      }

      variants.set(variantId, variantEntry);
    }
  }

  const productFieldChanges = Array.from(productFields.values()).filter(
    (fieldChange) =>
      JSON.stringify(normalizeFieldValue(fieldChange.oldValue)) !==
      JSON.stringify(normalizeFieldValue(fieldChange.newValue))
  );

  const variantFieldChanges = Array.from(variants.values())
    .map((variantEntry) => ({
      variantId: variantEntry.variantId,
      variantTitle: variantEntry.variantTitle,
      selectedOptions: variantEntry.selectedOptions,
      changes: Array.from(variantEntry.changesByField.values()).filter(
        (fieldChange) =>
          JSON.stringify(normalizeFieldValue(fieldChange.oldValue)) !==
          JSON.stringify(normalizeFieldValue(fieldChange.newValue))
      ),
    }))
    .filter((variantEntry) => variantEntry.changes.length > 0);

  if (!productFieldChanges.length && !variantFieldChanges.length) {
    return null;
  }

  return {
    editHistoryId: historyId,
    productId: product.id || product._id,
    shop,
    image: getProductImage(product),
    title: product.title,
    scope:
      variantFieldChanges.length > 0 && productFieldChanges.length === 0
        ? "variant"
        : "product",
    batchId,
    productFieldChanges,
    variantFieldChanges,
    status: "pending",
  };
}

export function compileProductBulkEdit({
  product,
  rules,
  historyId,
  shop,
  batchId,
}) {
  if (!product || typeof product !== "object") {
    fail("INVALID_BULK_EDIT_PRODUCT");
  }
  if (!Array.isArray(rules) || rules.length === 0) {
    fail("BULK_EDIT_RULES_REQUIRED");
  }

  const draftProduct = cloneValue(product);
  const productId = draftProduct?.id || draftProduct?._id;
  if (!productId) {
    fail("BULK_EDIT_PRODUCT_ID_REQUIRED");
  }

  const mergedPayload = { productSet: { id: productId } };
  const ruleChanges = [];

  for (const rawRule of rules) {
    const rule = normalizeRuleForCompile(rawRule);
    const localChanges = [];
    const line = getUpdatedProducts({
      product: draftProduct,
      field: rule.field,
      editType: rule.editOption,
      value: rule.value,
      searchKey: rule.searchKey,
      replaceText: rule.replaceText,
      supportValue: rule.supportValue,
      changes: localChanges,
      historyId,
      shop,
      batchId,
      confirmedDangerousOperation: rule.confirmedDangerousOperation === true,
      allowDirectExecution: true,
    });

    for (const entry of localChanges) {
      ruleChanges.push(entry);
    }

    if (!line) {
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      fail("INVALID_BULK_MUTATION_LINE");
    }

    if (parsed?.id && !parsed?.productSet) {
      return {
        formattedProduct: JSON.stringify({ id: productId }),
        changeRecord: buildAggregatedChangeRecord({
          product,
          historyId,
          shop,
          batchId,
          rawChanges: ruleChanges,
        }),
      };
    }

    if (!parsed?.productSet || !parsed.productSet.id) {
      fail("BULK_MUTATION_LINE_MISSING_PRODUCT_ID");
    }

    mergedPayload.productSet = deepMergeMutationPayload(
      mergedPayload.productSet,
      parsed.productSet
    );
    applyProductSetToDraftProduct(draftProduct, parsed.productSet);
  }

  const changeRecord = buildAggregatedChangeRecord({
    product,
    historyId,
    shop,
    batchId,
    rawChanges: ruleChanges,
  });

  if (!changeRecord) {
    return {
      formattedProduct: null,
      changeRecord: null,
    };
  }

  return {
    formattedProduct: JSON.stringify(mergedPayload),
    changeRecord,
  };
}

export const compileBulkEditProductMutation = compileProductBulkEdit;
