const FIELD_EXECUTION_MAPPINGS = {
  title: ({ set }) => ({
    field: "title",
    editOption: "Set text to value",
    value: set,
  }),
  handle: ({ set }) => ({
    field: "handle",
    editOption: "Set text to value",
    value: set,
  }),
  vendor: ({ set }) => ({
    field: "vendor",
    editOption: "Set text to value",
    value: set,
  }),
  productType: ({ set }) => ({
    field: "productType",
    editOption: "Set text to value",
    value: set,
  }),
  description: ({ set }) => ({
    field: "description",
    editOption: "Set text to value",
    value: set,
  }),
  metaTitle: ({ set }) => ({
    field: "metaTitle",
    editOption: "Set text to value",
    value: set,
  }),
  metaDescription: ({ set }) => ({
    field: "metaDescription",
    editOption: "Set text to value",
    value: set,
  }),
  status: ({ set }) => ({
    field: "status",
    editOption: "Set status",
    value: set,
  }),
  tags: (value) => {
    if (value.add) {
      return {
        field: "tags",
        editOption: "Add tag(s) to product",
        value: value.add.join(", "),
      };
    }

    if (value.remove) {
      return {
        field: "tags",
        editOption: "Remove tag(s) from product",
        value: value.remove.join(", "),
      };
    }

    return {
      field: "tags",
      editOption: "Set tags (overwrites existing)",
      value: value.set.join(", "),
    };
  },
  price: ({ set }) => ({
    field: "price",
    editOption: "Set to fixed value",
    value: set,
  }),
  compareAtPrice: ({ set }) => ({
    field: "compareAtPrice",
    editOption: "Set to fixed value",
    value: set,
  }),
  sku: ({ set }) => ({
    field: "sku",
    editOption: "Set text to value",
    value: set,
  }),
  barcode: ({ set }) => ({
    field: "barcode",
    editOption: "Set text to value",
    value: set,
  }),
  taxable: ({ set }) => ({
    field: "taxable",
    editOption: "Set taxable",
    value: String(set),
  }),
  inventoryPolicy: ({ set }) => ({
    field: "inventoryPolicy",
    editOption: "SET_INVENTORY_POLICY",
    value: set,
  }),
};

export function buildBulkRulePreviewFromSnippetOutput(normalizedOutput = {}) {
  return Object.entries(normalizedOutput).map(([field, value]) =>
    FIELD_EXECUTION_MAPPINGS[field](value),
  );
}
