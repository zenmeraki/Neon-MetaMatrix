import { EXPORT_PRESET } from "./exportPresets.js";

const DEFAULT_COLUMN_ALIASES = {
  id: "id",
  variant_id: "variant_id",
  title: "title",
  description: "description",
  vendor: "vendor",
  productType: "product_type",
  handle: "handle",
  status: "status",
  tags: "tags",
  collections: "collections",
  category: "category",
  metaTitle: "meta_title",
  metaDescription: "meta_description",
  price: "price",
  compareAtPrice: "compare_at_price",
  sku: "sku",
  barcode: "barcode",
  taxable: "taxable",
  option1Name: "option1_name",
  option2Name: "option2_name",
  option3Name: "option3_name",
  option1Values: "option1_value",
  option2Values: "option2_value",
  option3Values: "option3_value",
  googleShoppingEnabled: "google_shopping_enabled",
  googleShoppingAgeGroup: "google_shopping_age_group",
  googleShoppingCategory: "google_shopping_category",
  googleShoppingColor: "google_shopping_color",
  googleShoppingCondition: "google_shopping_condition",
  googleShoppingCustomLabel0: "google_shopping_custom_label_0",
  googleShoppingCustomLabel1: "google_shopping_custom_label_1",
  googleShoppingCustomLabel2: "google_shopping_custom_label_2",
  googleShoppingCustomLabel3: "google_shopping_custom_label_3",
  googleShoppingCustomLabel4: "google_shopping_custom_label_4",
  googleShoppingCustomProduct: "google_shopping_custom_product",
  googleShoppingGender: "google_shopping_gender",
  googleShoppingMpn: "google_shopping_mpn",
  googleShoppingMaterial: "google_shopping_material",
  googleShoppingSize: "google_shopping_size",
  googleShoppingSizeSystem: "google_shopping_size_system",
  googleShoppingSizeType: "google_shopping_size_type",
};

const MATRIXIFY_COLUMN_ALIASES = {
  id: "ID",
  variant_id: "Variant ID",
  title: "Title",
  description: "Body HTML",
  vendor: "Vendor",
  productType: "Type",
  handle: "Handle",
  status: "Status",
  tags: "Tags",
  collections: "Custom Collections",
  category: "Category",
  metaTitle: "SEO Title",
  metaDescription: "SEO Description",
  price: "Variant Price",
  compareAtPrice: "Variant Compare At Price",
  sku: "Variant SKU",
  barcode: "Variant Barcode",
  taxable: "Variant Taxable",
  option1Name: "Option1 Name",
  option2Name: "Option2 Name",
  option3Name: "Option3 Name",
  option1Values: "Option1 Value",
  option2Values: "Option2 Value",
  option3Values: "Option3 Value",
};

const GOOGLE_SHOPPING_COLUMN_ALIASES = {
  id: "id",
  variant_id: "item_group_id",
  title: "title",
  description: "description",
  handle: "link",
  vendor: "brand",
  productType: "product_type",
  status: "availability",
  price: "price",
  compareAtPrice: "sale_price",
  sku: "sku",
  barcode: "gtin",
  googleShoppingEnabled: "google_shopping_enabled",
  googleShoppingAgeGroup: "age_group",
  googleShoppingCategory: "google_product_category",
  googleShoppingColor: "color",
  googleShoppingCondition: "condition",
  googleShoppingCustomLabel0: "custom_label_0",
  googleShoppingCustomLabel1: "custom_label_1",
  googleShoppingCustomLabel2: "custom_label_2",
  googleShoppingCustomLabel3: "custom_label_3",
  googleShoppingCustomLabel4: "custom_label_4",
  googleShoppingCustomProduct: "custom_product",
  googleShoppingGender: "gender",
  googleShoppingMpn: "mpn",
  googleShoppingMaterial: "material",
  googleShoppingSize: "size",
  googleShoppingSizeSystem: "size_system",
  googleShoppingSizeType: "size_type",
};

const PRESET_ALIASES = {
  [EXPORT_PRESET.CUSTOM]: DEFAULT_COLUMN_ALIASES,
  [EXPORT_PRESET.MATRIXIFY]: {
    ...DEFAULT_COLUMN_ALIASES,
    ...MATRIXIFY_COLUMN_ALIASES,
  },
  [EXPORT_PRESET.GOOGLE_SHOPPING]: {
    ...DEFAULT_COLUMN_ALIASES,
    ...GOOGLE_SHOPPING_COLUMN_ALIASES,
  },
};

export function getColumnHeaderAlias(field, preset = EXPORT_PRESET.CUSTOM) {
  const map = PRESET_ALIASES[preset] || PRESET_ALIASES[EXPORT_PRESET.CUSTOM];
  return map[field] || field;
}

export function buildCsvHeaders(fields = [], { includeVariantId = false, preset = EXPORT_PRESET.CUSTOM } = {}) {
  const headers = ["id"];
  if (includeVariantId) headers.push("variant_id");
  headers.push(...fields);
  return headers.map((field) => getColumnHeaderAlias(field, preset));
}

