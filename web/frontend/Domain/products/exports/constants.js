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
};

export const allFields = Object.values(fieldDefinitions);
