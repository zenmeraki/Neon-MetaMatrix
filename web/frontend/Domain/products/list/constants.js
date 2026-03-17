/* ===============================
   Operator Definitions
================================ */

const STRING_OPERATORS = [
  "contains",
  "does not contain",
  "equals",
  "does not equal",
  "starts with",
  "ends with",
  "is empty/blank",
];

const DATE_OPERATORS = [
  "is before",
  "is after",
];

const NUMBER_OPERATORS = ["<", ">", "=", "!="];

const ENUM_OPERATORS = ["is", "is not"];

/* ===============================
   Filter Configuration
================================ */

export const FILTER_CONFIG = {
  product: [
    {
      key: "title",
      label: "Title",
      type: "string",
      isSearchable: false,
      operators: STRING_OPERATORS,
    },
    {
      key: "vendor",
      label: "Vendor",
      type: "string",
      isSearchable: false,
      operators: STRING_OPERATORS,
    },
    {
      key: "handle",
      label: "Handle (URL)",
      type: "string",
      isSearchable: false,
      operators: STRING_OPERATORS,
    },
    {
      key: "product_type",
      label: "Product Type",
      type: "string",
      isSearchable: true,
      api: "/api/products/product-type-all",
      operators: STRING_OPERATORS,
    },
    {
      key: "collection",
      label: "Collection",
      type: "string",
      isSearchable: true,
      api: "/api/collection/get-all",
      operators: ENUM_OPERATORS,
    },
    {
      key: "category",
      label: "Category",
      type: "string",
      isSearchable: true,
      api: "/api/category/get-all",
      operators: ENUM_OPERATORS,
    },
    {
      key: "description",
      label: "Description",
      type: "string",
      isSearchable: false,
      operators: STRING_OPERATORS,
    },
    {
      key: "option_name_1",
      label: "Option 1 Name",
      type: "string",
      isSearchable: false,
      operators: STRING_OPERATORS,
    },
    {
      key: "option_name_2",
      label: "Option 2 Name",
      type: "string",
      isSearchable: false,
      operators: STRING_OPERATORS,
    },
    {
      key: "option_name_3",
      label: "Option 3 Name",
      type: "string",
      isSearchable: false,
      operators: STRING_OPERATORS,
    },
    {
      key: "product_id",
      label: "Product ID",
      type: "string",
      isSearchable: false,
      operators: STRING_OPERATORS,
    },
    {
      key: "inventory_q",
      label: "Inventory Quantity",
      type: "number",
      isSearchable: false,
      operators: NUMBER_OPERATORS,
    },
    {
      key: "tag",
      label: "Tag",
      type: "string",
      isSearchable: false,
      operators: STRING_OPERATORS,
    },
    {
      key: "theme_template",
      label: "Theme Template",
      type: "string",
      isSearchable: false,
      operators: STRING_OPERATORS,
    },
    {
      key: "variant_count",
      label: "Variant Count",
      type: "number",
      isSearchable: false,
      operators: NUMBER_OPERATORS,
    },
    {
      key: "visible_online_store",
      label: "Visible on Online Store",
      type: "enum",
      isSearchable: false,
      operators: ["is"],
      values: ["true", "false"],
    },
    {
      key: "visible_pos",
      label: "Visible on POS",
      type: "enum",
      isSearchable: false,
      operators: ["is"],
      values: ["true", "false"],
    },
    {
      key: "updated_at",
      label: "Date Updated",
      type: "date",
      isSearchable: false,
      operators: DATE_OPERATORS,
    },
    {
      key: "created_at",
      label: "Date Created",
      type: "date",
      isSearchable: false,
      operators: DATE_OPERATORS,
    },
    {
      key: "published_at",
      label: "Date Published",
      type: "date",
      isSearchable: false,
      operators: DATE_OPERATORS,
    },
    {
      key: "status",
      label: "Status",
      type: "enum",
      isSearchable: false,
      operators: ["is"],
      values: ["ACTIVE", "DRAFT", "ARCHIVED"],
    },
  ],

  variant: [
    {
      key: "barcode",
      label: "Barcode",
      type: "string",
      isSearchable: false,
      operators: STRING_OPERATORS,
    },
    {
      key: "sku",
      label: "SKU",
      type: "string",
      isSearchable: false,
      operators: STRING_OPERATORS,
    },
    {
      key: "variant_title",
      label: "Variant Title",
      type: "string",
      isSearchable: false,
      operators: STRING_OPERATORS,
    },
    {
      key: "price",
      label: "Price",
      type: "number",
      isSearchable: false,
      operators: NUMBER_OPERATORS,
    },
    {
      key: "compare_at_price",
      label: "Compare-at Price",
      type: "number",
      isSearchable: false,
      operators: NUMBER_OPERATORS,
    },
    {
      key: "variant_inventory_q",
      label: "Variant Inventory Quantity",
      type: "number",
      isSearchable: false,
      operators: NUMBER_OPERATORS,
    },
    {
      key: "option_value_1",
      label: "Option 1 Value",
      type: "string",
      isSearchable: false,
      operators: STRING_OPERATORS,
    },
    {
      key: "option_value_2",
      label: "Option 2 Value",
      type: "string",
      isSearchable: false,
      operators: STRING_OPERATORS,
    },
    {
      key: "option_value_3",
      label: "Option 3 Value",
      type: "string",
      isSearchable: false,
      operators: STRING_OPERATORS,
    },
    {
      key: "charge_tax",
      label: "Charge Tax",
      type: "enum",
      isSearchable: false,
      operators: ["is"],
      values: ["true", "false"],
    },
    {
  key: "seo_visibility",
  label: "Search Engine Visibility (SEO)",
  type: "enum",
  isSearchable: false,
  operators: ["is"],
  values: ["true", "false"],
},
    {
      key: "cost",
      label: "Cost",
      type: "number",
      isSearchable: false,
      operators: NUMBER_OPERATORS,
    },
    {
      key: "country_of_origin",
      label: "Country of Origin",
      type: "string",
      isSearchable: false,
      operators: STRING_OPERATORS,
    },
    {
      key: "hs_tariff_code",
      label: "HS Tariff Code",
      type: "string",
      isSearchable: false,
      operators: STRING_OPERATORS,
    },
    {
      key: "inventory_policy",
      label: "Inventory Out of Stock Policy",
      type: "string",
      isSearchable: false,
      operators: STRING_OPERATORS,
    },
    {
      key: "physical_product",
      label: "Physical Product",
      type: "enum",
      isSearchable: false,
      operators: ["is"],
      values: ["true", "false"],
    },
    {
      key: "profit_margin",
      label: "Profit Margin",
      type: "number",
      isSearchable: false,
      operators: NUMBER_OPERATORS,
    },
    {
      key: "track_quantity",
      label: "Track Quantity",
      type: "enum",
      isSearchable: false,
      operators: ["is"],
      values: ["true", "false"],
    },
    {
      key: "weight",
      label: "Weight",
      type: "number",
      isSearchable: false,
      operators: NUMBER_OPERATORS,
    },
    {
      key: "weight_unit",
      label: "Weight Unit",
      type: "string",
      isSearchable: false,
      operators: STRING_OPERATORS,
    },
    {
      key: "connected_inventory_location",
      label: "Connected Inventory Location",
      type: "string",
      isSearchable: false,
      operators: STRING_OPERATORS,
    },
  ],
};

/* ===============================
   Helpers
================================ */

export const getAllFilters = () => [
  ...FILTER_CONFIG.product,
  ...FILTER_CONFIG.variant,
];

export const getFilterByKey = (key) =>
  getAllFilters().find((f) => f.key === key);