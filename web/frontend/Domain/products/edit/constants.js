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
  API_AUTOCOMPLETE: "api_autocomplete",
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
  API_AUTOCOMPLETE: "apiAutocomplete",
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

  text: {
    setValue: () =>
      createAction(
        "setTextToValue",
        "Set text to value",
        "textInput.enterText",
        FieldType.TEXT
      ),

    append: () =>
      createAction(
        "addTextToEnd",
        "Add text to end",
       "textInput.enterTextToAdd",
        FieldType.TEXT
      ),

    prepend: () =>
      createAction(
        "addTextToBeginning",
        "Add text to beginning",
         "textInput.enterTextToAdd",
        FieldType.TEXT
      ),

    removeFromEnd: () =>
      createAction(
        "removeTextFromEnd",
        "Remove text from end",
         "textInput.enterTextToRemove",
        FieldType.TEXT
      ),

    removeFromStart: () =>
      createAction(
        "removeTextFromBeginning",
        "Remove text from beginning",
         "textInput.enterTextToRemove",
        FieldType.TEXT
      ),

    limitLength: () =>
      createAction(
        "limitTextLength",
        "Limit length of text",
         "textInput.enterMaxCharacterLength",
        FieldType.NUMERIC
      ),

    searchReplace: () =>
      createAction(
        "searchReplace",
        "Search/Replace",
         "textInput.enterSearchAndReplaceValues",
        FieldType.TEXT,
        InputType.SEARCH_REPLACE
      ),

    removeFromWord: () =>
      createAction(
        "removeTextToEndFromWord",
        "Remove text from a word to the end",
       "textInput.enterWord",
        FieldType.TEXT
      ),

    removeUpToWord: () =>
      createAction(
        "removeTextUpToWord",
        "Remove text up to and including a word",
        "textInput.enterWord",
        FieldType.TEXT
      ),
  },

  array: {
    add: (placeholder = "item1, item2, item3") =>
      createAction(
        "tagActions.add",
        "Add tag(s) to product",
        "tagInput.commaSeparated",
        FieldType.ARRAY,
        InputType.SINGLE,
        { placeholder }
      ),

    remove: (placeholder = "item1, item2, item3") =>
      createAction(
        "tagActions.remove",
        "Remove tag(s) from product",
        "tagInput.commaSeparated",
        FieldType.ARRAY,
        InputType.SINGLE,
        { placeholder }
      ),

    rename: () =>
      createAction(
        "tagActions.rename",
        "Rename tag",
        "tagInput.rename",
        FieldType.ARRAY,
        InputType.SEARCH_REPLACE,
        {
          searchLabel: "tagInput.old",
          replaceLabel: "tagInput.new",
        }
      ),

    searchReplaceInItems: () =>
      createAction(
        "tagActions.searchReplace",
        "Search/replace within tag name",
        "tagInput.searchReplace",
        FieldType.ARRAY,
        InputType.SEARCH_REPLACE,
        {
          searchLabel: "tagInput.search",
          replaceLabel: "tagInput.replace",
        }
      ),

    setAll: (placeholder = "item1, item2, item3") =>
      createAction(
        "tagActions.setAll",
        "Set tags (overwrites existing)",
        "tagInput.commaSeparated",
        FieldType.ARRAY,
        InputType.SINGLE,
        { placeholder }
      ),

    addFromApi: (
      apiEndpoint,
      labelKey = "label",
      valueKey = "value",
      inputHelperLabel = "collectionSearch.label"
    ) =>
      createAction(
        "collectionActions.addToCollection",
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
      inputHelperLabel = "collectionSearch.label"
    ) =>
      createAction(
        "collectionActions.removeFromCollection",
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

  apiAutocomplete: {
    setValue: (apiEndpoint, labelKey = "label", valueKey = "value") =>
      createAction(
        "Set value",
        "Set value",
        "categorySearch.label",
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
      actionLabel: "statusActions.setStatus",
      actionValue: "Set status",
      helperLabel: "statusInput.selectProductStatus",
      choices: [
        { label: "statusChoices.active", value: "ACTIVE" },
        { label: "statusChoices.draft", value: "DRAFT" },
        { label: "statusChoices.archived", value: "ARCHIVED" },
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
        "/api/collection/get-all",
        "title",
        "id",
        "collectionSearch.label"
      ),
      ActionTemplates.array.removeFromApi(
        "/api/collection/get-all",
        "title",
        "id",
        "collectionSearch.label"
      ),
    ],
  },

  category: {
    label: "Category",
    value: "category",
    type: FieldType.API_AUTOCOMPLETE,
    category: "product",
    actions: [
      ActionTemplates.apiAutocomplete.setValue(
        "/api/category/get-all",
        "title",
        "id"
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
    label: "barcode",
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
        actionLabel: "taxActions.setTaxApplicability",
        actionValue: "Set taxable",
       helperLabel: "taxInput.shouldProductBeTaxable",   // ✅ FIX
        choices: [
        { label: "commonChoices.yes", value: "true" },
        { label: "commonChoices.no", value: "false" },
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
        actionLabel: "inventoryPolicyActions.setInventoryPolicy",
        actionValue: "SET_INVENTORY_POLICY",
         helperLabel: "inventoryPolicyInput.shouldContinueSellingOutOfStock",
       choices: [
        {
          label: "inventoryPolicyChoices.continueSelling",
          value: "CONTINUE",
        },
        {
          label: "inventoryPolicyChoices.denySelling",
          value: "DENY",
        },
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
    actions: [ActionTemplates.danger.deleteProducts()],
  },
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