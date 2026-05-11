export const FIELD_CONFIGS = {
  title: {
    fieldName: "title",
    displayName: "Title",
    getValue: (product) => product.title || "",
    isVariantLevel: false,
  },

  description: {
    fieldName: "descriptionHtml",
    displayName: "Description",
    getValue: (product) => product.descriptionHtml || product.description || "",
    getProcessedValue: (product) =>
      removeStripHtmlTags(product.descriptionHtml || product.description || ""),
    isVariantLevel: false,
    needsProcessing: false,
  },

  handle: {
    fieldName: "handle",
    displayName: "Handle",
    getValue: (product) => product.handle || "",
    isVariantLevel: false,
  },

  vendor: {
    fieldName: "vendor",
    displayName: "Vendor",
    getValue: (product) => product.vendor || "",
    isVariantLevel: false,
  },

  productType: {
    fieldName: "productType",
    displayName: "Product type",
    getValue: (product) => product.productType || "",
    isVariantLevel: false,
  },

  metaTitle: {
    fieldName: "seo.title",
    displayName: "Seo Meta Title",
    getValue: (product) => product.seo?.title || "",
    isVariantLevel: false,
  },

  metaDescription: {
    fieldName: "seo.description",
    displayName: "Seo Meta Description",
    getValue: (product) => product.seo?.description || "",
    isVariantLevel: false,
  },

  option1Name: {
    fieldName: "option1Name",
    displayName: "Option 1 Name",
    optionPosition: 1,
    isTextOperation: true,
    getValue: (product) =>
      product.options?.find((op) => op.position === 1)?.name || "",
    isVariantLevel: false,
  },

  option2Name: {
    fieldName: "option2Name",
    displayName: "Option 2 Name",
    optionPosition: 2,
    isTextOperation: true,
    getValue: (product) =>
      product.options?.find((op) => op.position === 2)?.name || "",
    isVariantLevel: false,
  },

  option3Name: {
    fieldName: "option3Name",
    displayName: "Option 3 Name",
    optionPosition: 3,
    isTextOperation: true,
    getValue: (product) =>
      product.options?.find((op) => op.position === 3)?.name || "",
    isVariantLevel: false,
  },

  option1Values: {
    fieldName: "option1Values",
    displayName: "Option 1 Values",
    optionPosition: 1,
    isTextOperation: true,
    getValue: (product) =>
      product.options?.find((op) => op.position === 1)?.values || [],
    isVariantLevel: false,
  },

  option2Values: {
    fieldName: "option2Values",
    displayName: "Option 2 Values",
    optionPosition: 2,
    isTextOperation: true,
    getValue: (product) =>
      product.options?.find((op) => op.position === 2)?.values || [],
    isVariantLevel: false,
  },

  option3Values: {
    fieldName: "option3Values",
    displayName: "Option 3 Values",
    optionPosition: 3,
    isTextOperation: true,
    getValue: (product) =>
      product.options?.find((op) => op.position === 3)?.values || [],
    isVariantLevel: false,
  },

  status: {
    fieldName: "status",
    displayName: "Status",
    getValue: (product) => product.status || "DRAFT",
    isVariantLevel: false,
  },

  collections: {
    fieldName: "collections",
    displayName: "Collections",
    isArray: true,
    isVariantLevel: false,
    getValue: (product) => product.collections || [],
    needsProcessing: false,
  },

  category: {
    fieldName: "category",
    displayName: "Category",
    getValue: (product) => product.category?.name || "",
    getRevertValue: (product) => product.category?.id || "",
    isVariantLevel: false,
    customOnly: true,
  },

  barcode: {
    fieldName: "barcode",
    displayName: "Barcode",
    getValue: (variant) => variant.barcode || "",
    isVariantLevel: true,
  },

  sku: {
    fieldName: "sku",
    displayName: "SKU",
    getValue: (variant) => variant.sku || "",
    isVariantLevel: true,
  },

  price: {
    fieldName: "price",
    displayName: "Price",
    getValue: (variant) => Number(variant.price) || 0,
    isVariantLevel: true,
    isNumeric: true,
  },

  compareAtPrice: {
    fieldName: "compareAtPrice",
    displayName: "Compare at price",
    getValue: (variant) => Number(variant.compareAtPrice) || 0,
    isVariantLevel: true,
    isNumeric: true,
  },

  taxable: {
    fieldName: "taxable",
    displayName: "Taxable",
    getValue: (variant) => variant.taxable,
    isVariantLevel: true,
    customOnly: true,
  },

  inventoryPolicy: {
    fieldName: "inventoryPolicy",
    displayName: "Continue selling inventory when out of stock",
    getValue: (variant) => variant.inventoryPolicy,
    isVariantLevel: true,
    customOnly: true,
  },

  inventory: {
    fieldName: "inventory",
    displayName: "Inventory Level",
    getValue: (variant) => {
      if (variant.inventoryQuantity == null) {
        const error = new Error("MISSING_INVENTORY_QUANTITY");
        error.code = "MISSING_INVENTORY_QUANTITY";
        throw error;
      }
      return Number(variant.inventoryQuantity);
    },
    isVariantLevel: true,
    isNumeric: true,
  },

  tags: {
    fieldName: "tags",
    displayName: "Tags",
    getValue: (product) => {
      if (!Array.isArray(product.tags)) {
        const error = new Error("INVALID_TAGS_FORMAT_IN_MIRROR");
        error.code = "INVALID_TAGS_FORMAT_IN_MIRROR";
        throw error;
      }
      return product.tags;
    },
    isVariantLevel: false,
    isArray: true,
  },

  deleteProducts: {
    fieldName: "deleteProducts",
    displayName: "Delete products",
    isVariantLevel: false,
    isDanger: true,
    requiresExplicitConfirmation: true,
  },
};

export const VARIANT_LEVEL_FIELD_NAMES = new Set(
  Object.entries(FIELD_CONFIGS)
    .filter(([, config]) => config?.isVariantLevel)
    .map(([field]) => field)
);

export function isVariantLevelField(field) {
  return VARIANT_LEVEL_FIELD_NAMES.has(field);
}

export const COLLECTION_OPERATIONS = {
  "Add to collection": {
    getTitle: (value) => `Add to collection(s): ${value}`,
    apply: (currentCollections, newCollectionIds, supportValue) => {
      const current = Array.isArray(currentCollections) ? currentCollections : [];
      const idsToAdd = newCollectionIds
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

      const existingIds = current.map((col) => col.id);
      const newCollections = idsToAdd.filter((id) => !existingIds.includes(id));
      const titles = current.map((col) => col.title).join(",");
      return {
        ids: [...existingIds, ...newCollections],
        titles: `${titles} ${titles ? ", " : ""}${supportValue}`,
      };
    },
  },
  "Remove from collection": {
    getTitle: (value) => `Remove from collection(s): ${value}`,
    apply: (currentCollections, collectionIdsToRemove, supportValue) => {
      const current = Array.isArray(currentCollections) ? currentCollections : [];
      const currentIds = current.map((clction) => clction.id);
      const idsToRemove = collectionIdsToRemove
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

      return {
        ids: currentIds.filter((id) => !idsToRemove.includes(id)),
        titles: current
          .filter(
            (col) =>
              !supportValue
                .split(",")
                .map((item) => item.trim())
                .includes(col.title)
          )
          .map((col) => col.title)
          .join(","),
      };
    },
  },
};

export const TEXT_OPERATIONS = {
  "Set text to value": {
    apply: (current, value) => value,
    getTitle: (value, fieldDisplay) => `${fieldDisplay} Set to "${value}"`,
  },
  "Add text to end": {
    apply: (current, value) => current + value,
    getTitle: (value, fieldDisplay) =>
      `"${value}" added to the end of ${fieldDisplay.toLowerCase()}`,
  },
  "Remove text from end": {
    apply: (current, value) =>
      current.endsWith(value) ? current.slice(0, -value.length) : current,
    getTitle: (value, fieldDisplay) =>
      `"${value}" removed from the end of ${fieldDisplay.toLowerCase()}`,
  },
  "Add text to beginning": {
    apply: (current, value) => value + current,
    getTitle: (value, fieldDisplay) =>
      `"${value}" added to the beginning of ${fieldDisplay.toLowerCase()}`,
  },
  "Remove text from beginning": {
    apply: (current, value) =>
      current.startsWith(value) ? current.slice(value.length) : current,
    getTitle: (value, fieldDisplay) =>
      `"${value}" removed from the beginning of ${fieldDisplay.toLowerCase()}`,
  },
  "Limit length of text": {
    apply: (current, value) => {
      const maxLength = parseInt(value, 10);
      return !isNaN(maxLength) && maxLength > 0
        ? current.slice(0, maxLength)
        : current;
    },
    getTitle: (value, fieldDisplay) =>
      `${fieldDisplay} limited to ${parseInt(value, 10)} characters`,
  },
  "Remove text from a word to the end": {
    apply: (current, value) => {
      const word = value.trim();
      return word && current.includes(word) ? current.split(word)[0] : current;
    },
    getTitle: (value, fieldDisplay) =>
      `Removed text from "${value.trim()}" to the end of ${fieldDisplay.toLowerCase()}`,
  },
  "Remove text up to and including a word": {
    apply: (current, value) => {
      const word = value.trim();
      return word && current.includes(word)
        ? current.split(word)[1] || ""
        : current;
    },
    getTitle: (value, fieldDisplay) =>
      `${fieldDisplay} - Removed text up to and including "${value.trim()}"`,
  },
  "Search/Replace": {
    apply: (current = "", value = {}) => {
      if (typeof current !== "string") return current;

      const searchKey = value.searchKey || "";
      const replaceText = value.text || "";

      if (!searchKey.trim()) return current;

      const safeSearch = escapeRegExp(searchKey);
      const regex = new RegExp(safeSearch, "g");

      return current.replace(regex, replaceText);
    },
    getTitle: (value, fieldDisplay) => {
      const searchKey = value.searchKey || "";
      const replaceText = value.text || "";
      if (!replaceText.trim()) {
        return `${fieldDisplay} - removed all "${searchKey}"`;
      }
      return `${fieldDisplay} - replaced "${searchKey}" with "${replaceText}"`;
    },
  },
};

export const NUMERIC_OPERATIONS = {
  "Increase by percent": {
    apply: (current, value) =>
      toFixed00(current * (1 + assertNumber(value) / 100)),
    getTitle: (value, fieldName) =>
      `${fieldName} Increased by ${assertNumber(value)}%`,
  },

  "Decrease by percent": {
    apply: (current, value) =>
      toFixed00(current * (1 - assertNumber(value) / 100)),
    getTitle: (value, fieldName) =>
      `${fieldName} Decreased by ${assertNumber(value)}%`,
  },

  "Changed by fixed amount": {
    apply: (current, value) => toFixed00(current + assertNumber(value)),
    getTitle: (value, fieldName) =>
      `${fieldName} Increased by Amount ${assertNumber(value).toFixed(2)}`,
  },

  "Set to fixed value": {
    apply: (_current, value) => toFixed00(assertNumber(value)),
    getTitle: (value, fieldName) =>
      `${fieldName} Set to ${assertNumber(value).toFixed(2)}`,
  },

  "Set to percentage of compare-at-price": {
    apply: (current, value) =>
      toFixed00(Number(current) * (assertNumber(value) / 100)),
    getTitle: (value, fieldName) =>
      `${fieldName} set to ${value}% of Compare-at price`,
    dependsOn: "compareAtPrice",
    isDepends: true,
  },
};

export const TAG_OPERATIONS = {
  "Add tag(s) to product": {
    apply: (current = [], value = "") =>
      Array.from(
        new Set([
          ...current,
          ...value
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        ])
      ),
    getTitle: (value) => `Added tags: ${value}`,
  },

  "Remove tag(s) from product": {
    apply: (current = [], value = "") => {
      const toRemove = value.split(",").map((t) => t.trim());
      return current.filter((t) => !toRemove.includes(t));
    },
    getTitle: (value) => `Removed tags: ${value}`,
  },

  "Set tags (overwrites existing)": {
    apply: (_current, value = "") =>
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    getTitle: (value) => `Tags set to: ${value}`,
  },

  "Rename tag": {
    apply: (current = [], value) =>
      current.map((t) => (t === value.searchKey ? value.text : t)),
    getTitle: (value) => `Renamed tag "${value.searchKey}" to "${value.text}"`,
  },

  "Search/replace within tag name": {
    apply: (current = [], value) => {
      const safeSearch = escapeRegExp(value.searchKey || "");
      const regex = new RegExp(safeSearch, "g");
      return current.map((t) => t.replace(regex, value.text || ""));
    },
    getTitle: (value) =>
      `Replaced "${value.searchKey}" inside tags with "${value.text}"`,
  },
};

function escapeRegExp(string = "") {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    const error = new Error("INVALID_NUMERIC_VALUE");
    error.code = "INVALID_NUMERIC_VALUE";
    throw error;
  }
  return num;
}

const toFixed00 = (num) => Number(num.toFixed(2));

function removeStripHtmlTags(html) {
  if (!html) return "";
  return html.replace(/<[^>]*>?/gm, "");
}
