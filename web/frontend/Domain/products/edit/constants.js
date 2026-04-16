// fieldConfig.js - Centralized field configuration

/**
 * Field Types Enum
 */
export const FieldType = {
  NUMERIC: "numeric",
  TEXT: "text",
  ARRAY: "array",
  ENUM: "enum",
  LOCATION: "location",
  DANGER: "danger",
  API_AUTOCOMPLETE: "api_autocomplete", // NEW: For API-driven autocomplete
};

/**
 * Input Types for different edit operations
 */
export const InputType = {
  SINGLE: "single",
  SEARCH_REPLACE: "searchReplace",
  CHOICE_LIST: "choiceList",
  LOCATION_SELECT: "locationSelect",
  NONE: "none",
  API_AUTOCOMPLETE: "apiAutocomplete", // NEW: For API-driven autocomplete
};

/**
 * Action factory function
 */
const createAction = (
  label,
  value,
  inputHelperLabel,
  type,
  inputType = InputType.SINGLE,
  config = {}
) => ({
  label,
  value,
  inputHelperLabel,
  type,
  inputType,
  ...config,
});

/**
 * Reusable Action Templates
 */
const ActionTemplates = {
  // Numeric operations
  numeric: {
    decreaseByPercent: () =>
      createAction(
        "Decrease by percent",
        "Decrease by percent",
        "Enter the percentage",
        FieldType.NUMERIC,
        InputType.SINGLE,
        { max: 100, suffix: "%" }
      ),

    increaseByPercent: () =>
      createAction(
        "Increase by percent",
        "Increase by percent",
        "Enter the percentage",
        FieldType.NUMERIC,
        InputType.SINGLE,
        { max: 100, suffix: "%" }
      ),

    changeByAmount: () =>
      createAction(
        "Changed by fixed amount",
        "Changed by fixed amount",
        "Enter the amount",
        FieldType.NUMERIC
      ),

    setToValue: () =>
      createAction(
        "Set to fixed value",
        "Set to fixed value",
        "Enter the value",
        FieldType.NUMERIC
      ),

    percentageOfCompareAtPrice: () =>
      createAction(
        "Set to percentage of compare-at-price field",
        "Set to percentage of compare-at-price",
        "Enter the percentage",
        FieldType.NUMERIC,
        InputType.SINGLE,
        { max: 100, suffix: "%" }
      ),
  },
  danger: {
    deleteProducts: () =>
      createAction(
        "Delete products",
        "DELETE_PRODUCTS",
        "This action will permanently delete selected products. This cannot be undone.",
        FieldType.DANGER,
        InputType.NONE,
        { requiresConfirmation: true }
      ),
  },

  // Text operations
  text: {
    setValue: () =>
      createAction(
        "Set text to value",
        "Set text to value",
        "Enter the text",
        FieldType.TEXT
      ),

    append: () =>
      createAction(
        "Add text to end",
        "Add text to end",
        "Enter the text to add",
        FieldType.TEXT
      ),

    prepend: () =>
      createAction(
        "Add text to beginning",
        "Add text to beginning",
        "Enter the text to add",
        FieldType.TEXT
      ),

    removeFromEnd: () =>
      createAction(
        "Remove text from end",
        "Remove text from end",
        "Enter the text to remove",
        FieldType.TEXT
      ),

    removeFromStart: () =>
      createAction(
        "Remove text from beginning",
        "Remove text from beginning",
        "Enter the text to remove",
        FieldType.TEXT
      ),

    limitLength: () =>
      createAction(
        "Limit length of text",
        "Limit length of text",
        "Enter max character length",
        FieldType.NUMERIC
      ),

    searchReplace: () =>
      createAction(
        "Search/Replace",
        "Search/Replace",
        "Enter search and replace values",
        FieldType.TEXT,
        InputType.SEARCH_REPLACE
      ),

    removeFromWord: () =>
      createAction(
        "Remove text from a word to the end",
        "Remove text from a word to the end",
        "Enter the word",
        FieldType.TEXT
      ),

    removeUpToWord: () =>
      createAction(
        "Remove text up to and including a word",
        "Remove text up to and including a word",
        "Enter the word",
        FieldType.TEXT
      ),
  },

  // Add new array template for API autocomplete with multiple selection
  array: {
    add: (placeholder = "item1, item2, item3") =>
      createAction(
        "Add tag(s) to product",
        "Add tag(s) to product",
        "Comma-separated tags",
        FieldType.ARRAY,
        InputType.SINGLE,
        { placeholder }
      ),

    remove: (placeholder = "item1, item2, item3") =>
      createAction(
        "Remove tag(s) from product",
        "Remove tag(s) from product",
        "Comma-separated tags",
        FieldType.ARRAY,
        InputType.SINGLE,
        { placeholder }
      ),

    rename: () =>
      createAction(
        "Rename tag",
        "Rename tag",
        "Old tag → New tag",
        FieldType.ARRAY,
        InputType.SEARCH_REPLACE,
        { searchLabel: "Old tag", replaceLabel: "New tag" }
      ),

    searchReplaceInItems: () =>
      createAction(
        "Search/replace within tag name",
        "Search/replace within tag name",
        "Search → Replace",
        FieldType.ARRAY,
        InputType.SEARCH_REPLACE,
        { searchLabel: "Search in tags", replaceLabel: "Replace with" }
      ),

    setAll: (placeholder = "item1, item2, item3") =>
      createAction(
        "Set tags (overwrites existing)",
        "Set tags (overwrites existing)",
        "Comma-separated tags",
        FieldType.ARRAY,
        InputType.SINGLE,
        { placeholder }
      ),

    // NEW: API autocomplete for arrays (multiple selection)
    addFromApi: (
      apiEndpoint,
      labelKey = "label",
      valueKey = "value",
      inputHelperLabel = "Search and select"
    ) =>
      createAction(
        "Add to collection",
        "Add to collection",
        inputHelperLabel,
        FieldType.ARRAY,
        InputType.API_AUTOCOMPLETE,
        {
          apiEndpoint,
          labelKey,
          valueKey,
          requiresApiData: true,
          allowMultiple: true,
        }
      ),

    removeFromApi: (
      apiEndpoint,
      labelKey = "label",
      valueKey = "value",
      inputHelperLabel = "Search and select"
    ) =>
      createAction(
        "Remove from collection",
        "Remove from collection",
        inputHelperLabel,
        FieldType.ARRAY,
        InputType.API_AUTOCOMPLETE,
        {
          apiEndpoint,
          labelKey,
          valueKey,
          requiresApiData: true,
          allowMultiple: true,
        }
      ),
  },

  // Enum operations (status, etc.)
  enum: {
    setValue: ({
      actionLabel = "Set value",
      actionValue = "Set value",
      helperLabel = "Select a value",
      choices = [],
    }) =>
      createAction(
        actionLabel,
        actionValue,
        helperLabel,
        FieldType.ENUM,
        InputType.CHOICE_LIST,
        { choices }
      ),
  },

  location: {
    decreaseByPercent: () =>
      createAction(
        "Decrease by percent",
        "Decrease by percent",
        "Enter the percentage",
        FieldType.NUMERIC,
        InputType.LOCATION_SELECT,
        { max: 100, suffix: "%" }
      ),

    increaseByPercent: () =>
      createAction(
        "Increase by percent",
        "Increase by percent",
        "Enter the percentage",
        FieldType.NUMERIC,
        InputType.LOCATION_SELECT,
        { max: 100, suffix: "%" }
      ),

    changeByAmount: () =>
      createAction(
        "Changed by fixed amount",
        "Changed by fixed amount",
        "Enter the amount",
        FieldType.NUMERIC,
        InputType.LOCATION_SELECT
      ),

    setToValue: () =>
      createAction(
        "Set to fixed value",
        "Set to fixed value",
        "Enter the value",
        FieldType.NUMERIC,
        InputType.LOCATION_SELECT
      ),
  },

  // NEW: API Autocomplete operations
  apiAutocomplete: {
    setValue: (apiEndpoint, labelKey = "label", valueKey = "value") =>
      createAction(
        "Set value",
        "Set value",
        "Search and select",
        FieldType.API_AUTOCOMPLETE,
        InputType.API_AUTOCOMPLETE,
        {
          apiEndpoint,
          labelKey,
          valueKey,
          requiresApiData: true,
        }
      ),
  },
};

/**
 * Field Definitions
 */
export const fieldDefinitions = {
  // ============================================
  // PRODUCT FIELDS
  // ============================================

  title: {
    label: "Title",
    value: "title",
    type: FieldType.TEXT,
    category: "product",
    actions: [
      ActionTemplates.text.setValue(),
      ActionTemplates.text.append(),
      ActionTemplates.text.prepend(),
      ActionTemplates.text.removeFromEnd(),
      ActionTemplates.text.removeFromStart(),
      ActionTemplates.text.limitLength(),
      ActionTemplates.text.searchReplace(),
      ActionTemplates.text.removeFromWord(),
      ActionTemplates.text.removeUpToWord(),
    ],
  },

  description: {
    label: "Description",
    value: "description",
    type: FieldType.TEXT,
    category: "product",
    actions: [
      ActionTemplates.text.setValue(),
      ActionTemplates.text.append(),
      ActionTemplates.text.prepend(),
      ActionTemplates.text.removeFromEnd(),
      ActionTemplates.text.removeFromStart(),
      ActionTemplates.text.limitLength(),
      ActionTemplates.text.searchReplace(),
      ActionTemplates.text.removeFromWord(),
      ActionTemplates.text.removeUpToWord(),
    ],
  },

  vendor: {
    label: "Vendor",
    value: "vendor",
    type: FieldType.TEXT,
    category: "product",
    actions: [
      ActionTemplates.text.setValue(),
      ActionTemplates.text.append(),
      ActionTemplates.text.prepend(),
      ActionTemplates.text.removeFromEnd(),
      ActionTemplates.text.removeFromStart(),
      ActionTemplates.text.limitLength(),
      ActionTemplates.text.searchReplace(),
      ActionTemplates.text.removeFromWord(),
      ActionTemplates.text.removeUpToWord(),
    ],
  },

  productType: {
    label: "Product Type",
    value: "productType",
    type: FieldType.TEXT,
    category: "product",
    actions: [
      ActionTemplates.text.setValue(),
      ActionTemplates.text.append(),
      ActionTemplates.text.prepend(),
      ActionTemplates.text.removeFromEnd(),
      ActionTemplates.text.removeFromStart(),
      ActionTemplates.text.limitLength(),
      ActionTemplates.text.searchReplace(),
      ActionTemplates.text.removeFromWord(),
      ActionTemplates.text.removeUpToWord(),
    ],
  },

  option1Name: {
    label: "Option 1 Name",
    value: "option1Name",
    type: FieldType.TEXT,
    category: "product",
    actions: [
      ActionTemplates.text.setValue(),
      ActionTemplates.text.append(),
      ActionTemplates.text.prepend(),
      ActionTemplates.text.removeFromEnd(),
      ActionTemplates.text.removeFromStart(),
      ActionTemplates.text.limitLength(),
      ActionTemplates.text.searchReplace(),
      ActionTemplates.text.removeFromWord(),
      ActionTemplates.text.removeUpToWord(),
    ],
  },
  option2Name: {
    label: "Option 2 Name",
    value: "option2Name",
    type: FieldType.TEXT,
    category: "product",
    actions: [
      ActionTemplates.text.setValue(),
      ActionTemplates.text.append(),
      ActionTemplates.text.prepend(),
      ActionTemplates.text.removeFromEnd(),
      ActionTemplates.text.removeFromStart(),
      ActionTemplates.text.limitLength(),
      ActionTemplates.text.searchReplace(),
      ActionTemplates.text.removeFromWord(),
      ActionTemplates.text.removeUpToWord(),
    ],
  },
  option3Name: {
    label: "Option 3 Name",
    value: "option3Name",
    type: FieldType.TEXT,
    category: "product",
    actions: [
      ActionTemplates.text.setValue(),
      ActionTemplates.text.append(),
      ActionTemplates.text.prepend(),
      ActionTemplates.text.removeFromEnd(),
      ActionTemplates.text.removeFromStart(),
      ActionTemplates.text.limitLength(),
      ActionTemplates.text.searchReplace(),
      ActionTemplates.text.removeFromWord(),
      ActionTemplates.text.removeUpToWord(),
    ],
  },
  
  metaTitle: {
    label: "Seo Meta Title",
    value: "metaTitle",
    type: FieldType.TEXT,
    category: "product",
    actions: [
      ActionTemplates.text.setValue(),
      ActionTemplates.text.append(),
      ActionTemplates.text.prepend(),
      ActionTemplates.text.removeFromEnd(),
      ActionTemplates.text.removeFromStart(),
      ActionTemplates.text.limitLength(),
      ActionTemplates.text.searchReplace(),
      ActionTemplates.text.removeFromWord(),
      ActionTemplates.text.removeUpToWord(),
    ],
  },
  metaDescription: {
    label: "Seo Meta Description",
    value: "metaDescription",
    type: FieldType.TEXT,
    category: "product",
    actions: [
      ActionTemplates.text.setValue(),
      ActionTemplates.text.append(),
      ActionTemplates.text.prepend(),
      ActionTemplates.text.removeFromEnd(),
      ActionTemplates.text.removeFromStart(),
      ActionTemplates.text.limitLength(),
      ActionTemplates.text.searchReplace(),
      ActionTemplates.text.removeFromWord(),
      ActionTemplates.text.removeUpToWord(),
    ],
  },

  handle: {
    label: "Handle",
    value: "handle",
    type: FieldType.TEXT,
    category: "product",
    actions: [
      ActionTemplates.text.append(),
      ActionTemplates.text.prepend(),
      ActionTemplates.text.removeFromEnd(),
      ActionTemplates.text.removeFromStart(),
      ActionTemplates.text.limitLength(),
      ActionTemplates.text.searchReplace(),
      ActionTemplates.text.removeFromWord(),
      ActionTemplates.text.removeUpToWord(),
    ],
  },

  status: {
    label: "Status",
    value: "status",
    type: FieldType.ENUM,
    category: "product",
    actions: [
      ActionTemplates.enum.setValue({
        actionLabel: "Set status",
        actionValue: "Set status",
        helperLabel: "Select product status",
        choices: [
          { label: "Active", value: "ACTIVE" },
          { label: "Draft", value: "DRAFT" },
          { label: "Archived", value: "ARCHIVED" },
        ],
      }),
    ],
  },

  tags: {
    label: "Tags",
    value: "tags",
    type: FieldType.ARRAY,
    category: "product",
    actions: [
      ActionTemplates.array.add("tag1, tag2, tag3"),
      ActionTemplates.array.remove("tag1, tag2, tag3"),
      ActionTemplates.array.rename(),
      ActionTemplates.array.searchReplaceInItems(),
      ActionTemplates.array.setAll("tag1, tag2, tag3"),
    ],
  },

  collections: {
    label: "Collections",
    value: "collections",
    type: FieldType.ARRAY,
    category: "product",
    actions: [
      ActionTemplates.array.addFromApi(
        "/api/collection/get-all", // Your API endpoint
        "title", // Key for label in API response
        "id", // Key for value in API response
        "Search and select collections"
      ),
      ActionTemplates.array.removeFromApi(
        "/api/collection/get-all", // Your API endpoint
        "title", // Key for label in API response
        "id", // Key for value in API response
        "Search and select collections"
      ),
    ],
  },

  // NEW: Category field with API-driven autocomplete
  category: {
    label: "Category",
    value: "category",
    type: FieldType.API_AUTOCOMPLETE,
    category: "product",
    actions: [
      ActionTemplates.apiAutocomplete.setValue(
        "/api/category/get-all", // Your API endpoint
        "title", // Key for label in API response
        "id" // Key for value in API response
      ),
    ],
  },

  price: {
    label: "Price",
    value: "price",
    type: FieldType.NUMERIC,
    category: "variant",
    actions: [
      ActionTemplates.numeric.decreaseByPercent(),
      ActionTemplates.numeric.increaseByPercent(),
      ActionTemplates.numeric.changeByAmount(),
      ActionTemplates.numeric.setToValue(),
      ActionTemplates.numeric.percentageOfCompareAtPrice(),
    ],
    validation: {
      min: 0,
      allowDecimal: true,
    },
  },
  compareAtPrice: {
    label: "Compare at price",
    value: "compareAtPrice",
    type: FieldType.NUMERIC,
    category: "variant",
    actions: [
      ActionTemplates.numeric.decreaseByPercent(),
      ActionTemplates.numeric.increaseByPercent(),
      ActionTemplates.numeric.changeByAmount(),
      ActionTemplates.numeric.setToValue(),
    ],
    validation: {
      min: 0,
      allowDecimal: true,
    },
  },

  sku: {
    label: "SKU",
    value: "sku",
    type: FieldType.TEXT,
    category: "variant",
    actions: [
      ActionTemplates.text.setValue(),
      ActionTemplates.text.append(),
      ActionTemplates.text.prepend(),
      ActionTemplates.text.removeFromEnd(),
      ActionTemplates.text.removeFromStart(),
      ActionTemplates.text.limitLength(),
      ActionTemplates.text.searchReplace(),
      ActionTemplates.text.removeFromWord(),
      ActionTemplates.text.removeUpToWord(),
    ],
  },

  barcode: {
    label: "Barcode",
    value: "barcode",
    type: FieldType.TEXT,
    category: "variant",
    actions: [
      ActionTemplates.text.setValue(),
      ActionTemplates.text.append(),
      ActionTemplates.text.prepend(),
      ActionTemplates.text.removeFromEnd(),
      ActionTemplates.text.removeFromStart(),
      ActionTemplates.text.limitLength(),
      ActionTemplates.text.searchReplace(),
      ActionTemplates.text.removeFromWord(),
      ActionTemplates.text.removeUpToWord(),
    ],
  },

  taxable: {
    label: "Charge tax on this product",
    value: "taxable",
    type: FieldType.ENUM,
    category: "variant",
    actions: [
      ActionTemplates.enum.setValue({
        actionLabel: "Set tax applicability",
        actionValue: "Set taxable",
        helperLabel: "Should this product be taxable?",
        choices: [
          { label: "Yes", value: "true" },
          { label: "No", value: "false" },
        ],
      }),
    ],
  },

  inventoryPolicy: {
    label: "Continue selling inventory when out of stock",
    value: "inventoryPolicy",
    type: FieldType.ENUM,
    category: "variant",
    actions: [
      ActionTemplates.enum.setValue({
        actionLabel: "Set inventory policy",
        actionValue: "SET_INVENTORY_POLICY",
        helperLabel: "Should this product continue selling when inventory is out of stock?",
        choices: [
          { label: "Continue selling when out of stock", value: "CONTINUE" },
          { label: "Don't continue selling when out of stock", value: "DENY" },
        ],
      }),
    ],
  },

  option1Values: {
    label: "Option 1 Values",
    value: "option1Values",
    type: FieldType.TEXT,
    category: "variant",
    actions: [
      // ActionTemplates.text.setValue(),
      ActionTemplates.text.append(),
      ActionTemplates.text.prepend(),
      ActionTemplates.text.removeFromEnd(),
      ActionTemplates.text.removeFromStart(),
      ActionTemplates.text.limitLength(),
      ActionTemplates.text.searchReplace(),
      ActionTemplates.text.removeFromWord(),
      ActionTemplates.text.removeUpToWord(),
    ],
  },
  option2Values: {
    label: "Option 2 Values",
    value: "option2Values",
    type: FieldType.TEXT,
    category: "variant",
    actions: [
      // ActionTemplates.text.setValue(),
      ActionTemplates.text.append(),
      ActionTemplates.text.prepend(),
      ActionTemplates.text.removeFromEnd(),
      ActionTemplates.text.removeFromStart(),
      ActionTemplates.text.limitLength(),
      ActionTemplates.text.searchReplace(),
      ActionTemplates.text.removeFromWord(),
      ActionTemplates.text.removeUpToWord(),
    ],
  },
  option3Values: {
    label: "Option 3 Values",
    value: "option3Values",
    type: FieldType.TEXT,
    category: "variant",
    actions: [
      // ActionTemplates.text.setValue(),
      ActionTemplates.text.append(),
      ActionTemplates.text.prepend(),
      ActionTemplates.text.removeFromEnd(),
      ActionTemplates.text.removeFromStart(),
      ActionTemplates.text.limitLength(),
      ActionTemplates.text.searchReplace(),
      ActionTemplates.text.removeFromWord(),
      ActionTemplates.text.removeUpToWord(),
    ],
  },
  deleteProducts: {
    label: "Delete products",
    value: "deleteProducts",
    type: FieldType.DANGER,
    category: "danger",
    actions: [
      ActionTemplates.danger.deleteProducts(),
    ],
  },
  // inventory: {
  //   label: "Inventory Level",
  //   value: "inventory",
  //   type: FieldType.NUMERIC, // Changed to NUMERIC like price
  //   category: "variant",
  //   actions: [
  //     ActionTemplates.location.increaseByPercent(),
  //     ActionTemplates.location.changeByAmount(),
  //     ActionTemplates.location.setToValue(),
  //     ActionTemplates.location.decreaseByPercent(),
  //   ],
  //   validation: {
  //     min: 0,
  //     allowDecimal: false, // Inventory is typically whole numbers
  //   },
  // },
};

/**
 * Helper Functions
 */
export const getFieldsByCategory = (category) => {
  return Object.values(fieldDefinitions).filter(
    (field) => field.category === category
  );
};

export const getAllFields = () => {
  return Object.values(fieldDefinitions);
};

export const getFieldActions = (fieldValue) => {
  return fieldDefinitions[fieldValue]?.actions || [];
};

export const getFieldDefinition = (fieldValue) => {
  return fieldDefinitions[fieldValue];
};

export const getFieldType = (fieldValue) => {
  return fieldDefinitions[fieldValue]?.type;
};

export const getFieldValidation = (fieldValue) => {
  return fieldDefinitions[fieldValue]?.validation || {};
};

// Backward compatibility exports
export const productFieldOptions = getFieldsByCategory("product").map((f) => ({
  label: f.label,
  value: f.value,
}));

export const variantFieldOptions = getFieldsByCategory("variant").map((f) => ({
  label: f.label,
  value: f.value,
}));

export const allFields = getAllFields().map((f) => ({
  label: f.label,
  value: f.value,
}));

// Deprecated - use getFieldActions instead
export const editTypeOptions = Object.keys(fieldDefinitions).reduce(
  (acc, key) => {
    acc[key] = fieldDefinitions[key].actions;
    return acc;
  },
  {}
);
