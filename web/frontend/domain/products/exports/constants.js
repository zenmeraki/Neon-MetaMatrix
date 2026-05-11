export const fieldDefinitions = {
    // PRODUCT
    title: { label: "Title", value: "title", group: "product" },
    description: { label: "Description", value: "description", group: "product" },
    vendor: { label: "Vendor", value: "vendor", group: "product" },
    productType: { label: "Product Type", value: "productType", group: "product" },
    handle: { label: "Handle", value: "handle", group: "product" },
    status: { label: "Status", value: "status", group: "product" },
    tags: { label: "Tags", value: "tags", group: "product" },
    collections: { label: "Collections", value: "collections", group: "product" },
    category: { label: "Category", value: "category", group: "product" },

    
    // SEO
    metaTitle: { label: "SEO Meta Title", value: "metaTitle", group: "seo" },
    metaDescription: {
        label: "SEO Meta Description",
        value: "metaDescription",
        group: "seo",
    },

    // VARIANT
    price: { label: "Price", value: "price", group: "variant" },
    compareAtPrice: {
        label: "Compare at price",
        value: "compareAtPrice",
        group: "variant",
    },
    sku: { label: "SKU", value: "sku", group: "variant" },
    barcode: { label: "Barcode", value: "barcode", group: "variant" },
    taxable: {
        label: "Charge tax on this product",
        value: "taxable",
        group: "variant",
    },

    option1Name: { label: "Option 1 Name", value: "option1Name", group: "variant" },
    option2Name: { label: "Option 2 Name", value: "option2Name", group: "variant" },
    option3Name: { label: "Option 3 Name", value: "option3Name", group: "variant" },

    option1Values: {
        label: "Option 1 Values",
        value: "option1Values",
        group: "variant",
    },
    option2Values: {
        label: "Option 2 Values",
        value: "option2Values",
        group: "variant",
    },
    option3Values: {
        label: "Option 3 Values",
        value: "option3Values",
        group: "variant",
    },

    // GOOGLE SHOPPING
    googleShoppingEnabled: {
        label: "Google Shopping Enabled",
        value: "googleShoppingEnabled",
        group: "google",
    },
    googleShoppingAgeGroup: {
        label: "Google Shopping Age Group",
        value: "googleShoppingAgeGroup",
        group: "google",
    },
    googleShoppingCategory: {
        label: "Google Shopping Category",
        value: "googleShoppingCategory",
        group: "google",
    },
    googleShoppingColor: {
        label: "Google Shopping Color",
        value: "googleShoppingColor",
        group: "google",
    },
    googleShoppingCondition: {
        label: "Google Shopping Condition",
        value: "googleShoppingCondition",
        group: "google",
    },
    googleShoppingCustomLabel0: {
        label: "Google Shopping Custom Label 0",
        value: "googleShoppingCustomLabel0",
        group: "google",
    },
    googleShoppingCustomLabel1: {
        label: "Google Shopping Custom Label 1",
        value: "googleShoppingCustomLabel1",
        group: "google",
    },
    googleShoppingCustomLabel2: {
        label: "Google Shopping Custom Label 2",
        value: "googleShoppingCustomLabel2",
        group: "google",
    },
    googleShoppingCustomLabel3: {
        label: "Google Shopping Custom Label 3",
        value: "googleShoppingCustomLabel3",
        group: "google",
    },
    googleShoppingCustomLabel4: {
        label: "Google Shopping Custom Label 4",
        value: "googleShoppingCustomLabel4",
        group: "google",
    },
    googleShoppingCustomProduct: {
        label: "Google Shopping Custom Product",
        value: "googleShoppingCustomProduct",
        group: "google",
    },
    googleShoppingGender: {
        label: "Google Shopping Gender",
        value: "googleShoppingGender",
        group: "google",
    },
    googleShoppingMpn: {
        label: "Google Shopping MPN",
        value: "googleShoppingMpn",
        group: "google",
    },
    googleShoppingMaterial: {
        label: "Google Shopping Material",
        value: "googleShoppingMaterial",
        group: "google",
    },
    googleShoppingSize: {
        label: "Google Shopping Size",
        value: "googleShoppingSize",
        group: "google",
    },
    googleShoppingSizeSystem: {
        label: "Google Shopping Size System",
        value: "googleShoppingSizeSystem",
        group: "google",
    },
    googleShoppingSizeType: {
        label: "Google Shopping Size Type",
        value: "googleShoppingSizeType",
        group: "google",
    },
};

export const allFields = Object.values(fieldDefinitions);

export const exportPresets = [
  { label: "Custom", value: "custom" },
  { label: "Matrixify", value: "matrixify" },
  { label: "Google Shopping", value: "google_shopping" },
];

export const presetFieldMap = {
  custom: [],
  matrixify: [
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
  ],
  google_shopping: [
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
  ],
};
