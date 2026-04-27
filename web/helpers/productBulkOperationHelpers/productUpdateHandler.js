//web/helpers/productBilkOperationHelpers/productUpdateHandler.js
import {
  FIELD_CONFIGS,
  TEXT_OPERATIONS,
  NUMERIC_OPERATIONS,
  TAG_OPERATIONS,
  COLLECTION_OPERATIONS,
} from "./constants.js";

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
    console.warn(`⚠️ Unknown field: ${field}`);
    return [];
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
      console.warn(`⚠️ Unknown collection operation: ${editType}`);
      return [];
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
      console.warn(`⚠️ Unknown tag operation: ${editType}`);
      return [];
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
    console.warn(`⚠️ Unknown operation: ${editType} for field ${field}`);
    return [];
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
    const newValue = operation.apply(currentValue, value);

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
  const newValue = operation.apply(currentValue, value);

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
  const options = Array.isArray(product?.options) ? product.options : [];

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
            ? Number(newValue).toFixed(2)
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
    options: options.map((op) => ({
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
        ? Number(newValue).toFixed(2)
        : newValue;

      return {
        variantId: variant.id,
        variantTitle: variant.title,
        selectedOptions: (variant.selectedOptions ?? []).map((op) => ({
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
      productOptions: product.options.map((op) => ({
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
          ? Number(newValue).toFixed(2)
          : newValue;

        return {
          id: variant.id,
          optionValues: (variant.selectedOptions ?? []).map((op) => ({
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
      tags: updatedTags.join(", "), // Shopify requires string
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
 if (!product.featuredImageId && !product.featuredMedia?.preview?.image?.url) {
  return "";
}


  if (product.featuredMedia?.preview?.image?.url) {
    return product.featuredMedia.preview.image.url;
  }

  return "";
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
}) => {
  if (!field) {
    console.error("❌ Field is required");
    return [];
  }
  const config = FIELD_CONFIGS[field];
  if (config?.isDanger) {
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
    "Meta Title": { seo: { title: newValue } },
    "Meta Description": { seo: { description: newValue } },
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
