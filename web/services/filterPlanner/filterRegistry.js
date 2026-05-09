import {
  DATE_OPERATORS,
  ENUM_OPERATORS,
  NUMBER_OPERATORS,
  STRING_OPERATORS,
} from "./filterOperators.js";

export const FILTER_FIELD_REGISTRY = {
  title: {
    domain: "product",
    type: "string",
    postgresColumn: "title",
    clickhouseColumn: "title",
    selectivity: 0.25,
    allowedOperators: STRING_OPERATORS,
    isVariantLevel: false,
  },

  vendor: {
    domain: "product",
    type: "string",
    postgresColumn: "vendor",
    clickhouseColumn: "vendor",
    selectivity: 0.15,
    allowedOperators: STRING_OPERATORS,
    isVariantLevel: false,
  },

  status: {
    domain: "product",
    type: "enum",
    postgresColumn: "status",
    clickhouseColumn: "status",
    selectivity: 0.35,
    allowedOperators: ENUM_OPERATORS,
    isVariantLevel: false,
  },

  createdAt: {
    domain: "product",
    type: "date",
    postgresColumn: "created_at",
    prismaField: "createdAt",
    clickhouseColumn: "created_at",
    selectivity: 0.4,
    allowedOperators: DATE_OPERATORS,
    isVariantLevel: false,
  },

  updatedAt: {
    domain: "product",
    type: "date",
    postgresColumn: "updated_at",
    prismaField: "updatedAt",
    clickhouseColumn: "updated_at",
    selectivity: 0.45,
    allowedOperators: DATE_OPERATORS,
    isVariantLevel: false,
  },

  price: {
    domain: "variant",
    type: "number",
    postgresColumn: "price",
    clickhouseColumn: "variant_price",
    selectivity: 0.3,
    allowedOperators: NUMBER_OPERATORS,
    isVariantLevel: true,
  },

  sku: {
    domain: "variant",
    type: "string",
    postgresColumn: "sku",
    clickhouseColumn: "variant_sku",
    selectivity: 0.08,
    allowedOperators: STRING_OPERATORS,
    isVariantLevel: true,
  },

  collection: {
    domain: "collection",
    type: "string",
    postgresRelation: {
      path: ["collections", "collection", "title"],
      resolver: "collections.collection.title",
    },
    clickhouseColumn: "collection_titles",
    selectivity: 0.2,
    allowedOperators: STRING_OPERATORS,
    isVariantLevel: false,
  },
};

export function getFilterFieldConfig(field) {
  return FILTER_FIELD_REGISTRY[field] || null;
}
