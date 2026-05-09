const BASE_EXPORT_FIELDS = [
  "title",
  "description",
  "vendor",
  "productType",
  "handle",
  "status",
  "tags",
  "collections",
  "category",
  "metaTitle",
  "metaDescription",
  "price",
  "compareAtPrice",
  "sku",
  "barcode",
  "taxable",
  "option1Name",
  "option2Name",
  "option3Name",
  "option1Values",
  "option2Values",
  "option3Values",
];

const GOOGLE_SHOPPING_FIELDS = [
  "title",
  "description",
  "handle",
  "vendor",
  "productType",
  "status",
  "price",
  "compareAtPrice",
  "sku",
  "barcode",
  "googleShoppingEnabled",
  "googleShoppingAgeGroup",
  "googleShoppingCategory",
  "googleShoppingColor",
  "googleShoppingCondition",
  "googleShoppingCustomLabel0",
  "googleShoppingCustomLabel1",
  "googleShoppingCustomLabel2",
  "googleShoppingCustomLabel3",
  "googleShoppingCustomLabel4",
  "googleShoppingCustomProduct",
  "googleShoppingGender",
  "googleShoppingMpn",
  "googleShoppingMaterial",
  "googleShoppingSize",
  "googleShoppingSizeSystem",
  "googleShoppingSizeType",
];

export const EXPORT_PRESET = {
  CUSTOM: "custom",
  MATRIXIFY: "matrixify",
  GOOGLE_SHOPPING: "google_shopping",
};

const PRESET_FIELD_MAP = {
  [EXPORT_PRESET.CUSTOM]: BASE_EXPORT_FIELDS,
  [EXPORT_PRESET.MATRIXIFY]: BASE_EXPORT_FIELDS,
  [EXPORT_PRESET.GOOGLE_SHOPPING]: GOOGLE_SHOPPING_FIELDS,
};

function sameFieldSet(a = [], b = []) {
  if (a.length !== b.length) return false;
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.every((value, index) => value === right[index]);
}

export function normalizeExportPreset(value) {
  if (!value) return EXPORT_PRESET.CUSTOM;
  const normalized = String(value).trim().toLowerCase();
  return PRESET_FIELD_MAP[normalized] ? normalized : EXPORT_PRESET.CUSTOM;
}

export function getPresetFields(preset) {
  return PRESET_FIELD_MAP[normalizeExportPreset(preset)] || BASE_EXPORT_FIELDS;
}

export function resolveExportFields({ fields = [], preset = EXPORT_PRESET.CUSTOM }) {
  const normalizedFields = Array.isArray(fields)
    ? fields.map((field) => String(field).trim()).filter(Boolean)
    : [];
  if (normalizedFields.length > 0) {
    return [...new Set(normalizedFields)];
  }
  return [...new Set(getPresetFields(preset))];
}

export function inferExportPresetFromFields(fields = []) {
  const normalizedFields = Array.isArray(fields)
    ? fields.map((field) => String(field).trim()).filter(Boolean)
    : [];
  if (!normalizedFields.length) return EXPORT_PRESET.CUSTOM;
  if (sameFieldSet(normalizedFields, PRESET_FIELD_MAP[EXPORT_PRESET.GOOGLE_SHOPPING])) {
    return EXPORT_PRESET.GOOGLE_SHOPPING;
  }
  if (sameFieldSet(normalizedFields, PRESET_FIELD_MAP[EXPORT_PRESET.MATRIXIFY])) {
    return EXPORT_PRESET.MATRIXIFY;
  }
  return EXPORT_PRESET.CUSTOM;
}
