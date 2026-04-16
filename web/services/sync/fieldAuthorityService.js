import {
  CATALOG_BULK_QUERY_DEFINITIONS,
} from "../../graphql/catalogBulkQueries.js";

/**
 * Field authority service.
 *
 * Responsibilities:
 * - define which sync domain owns which catalog fields
 * - expose query surfaces for each authority domain
 * - provide deterministic metadata for future workers/read services
 *
 * Not responsible for:
 * - Shopify API calls
 * - Prisma access
 * - ingestion
 * - controller response shaping
 */

export const FIELD_AUTHORITY_DOMAIN = {
  PRODUCT_VARIANT_BASELINE: "PRODUCT_VARIANT_BASELINE",
  COLLECTION_MEMBERSHIP: "COLLECTION_MEMBERSHIP",
  PRODUCT_TRACKED_METAFIELDS: "PRODUCT_TRACKED_METAFIELDS",
  VARIANT_TRACKED_METAFIELDS: "VARIANT_TRACKED_METAFIELDS",
  PRODUCT_TYPE_ONLY: "PRODUCT_TYPE_ONLY",
  PRODUCT_IDENTITY_LIGHT: "PRODUCT_IDENTITY_LIGHT",
};

const AUTHORITY_DEFINITIONS = {
  [FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE]: {
    domain: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
    ...CATALOG_BULK_QUERY_DEFINITIONS.PRODUCT_VARIANT_BASELINE,
    description: "Product, variant, option, and inventory item baseline.",
  },
  [FIELD_AUTHORITY_DOMAIN.COLLECTION_MEMBERSHIP]: {
    domain: FIELD_AUTHORITY_DOMAIN.COLLECTION_MEMBERSHIP,
    ...CATALOG_BULK_QUERY_DEFINITIONS.COLLECTION_MEMBERSHIP,
    description: "Collection identity and product membership.",
  },
  [FIELD_AUTHORITY_DOMAIN.PRODUCT_TRACKED_METAFIELDS]: {
    domain: FIELD_AUTHORITY_DOMAIN.PRODUCT_TRACKED_METAFIELDS,
    ...CATALOG_BULK_QUERY_DEFINITIONS.PRODUCT_TRACKED_METAFIELDS,
    description: "Tracked product metafields.",
  },
  [FIELD_AUTHORITY_DOMAIN.VARIANT_TRACKED_METAFIELDS]: {
    domain: FIELD_AUTHORITY_DOMAIN.VARIANT_TRACKED_METAFIELDS,
    ...CATALOG_BULK_QUERY_DEFINITIONS.VARIANT_TRACKED_METAFIELDS,
    description: "Tracked variant metafields.",
  },
  [FIELD_AUTHORITY_DOMAIN.PRODUCT_TYPE_ONLY]: {
    domain: FIELD_AUTHORITY_DOMAIN.PRODUCT_TYPE_ONLY,
    ...CATALOG_BULK_QUERY_DEFINITIONS.PRODUCT_TYPE_ONLY,
    description: "Lightweight productType refresh.",
  },
  [FIELD_AUTHORITY_DOMAIN.PRODUCT_IDENTITY_LIGHT]: {
    domain: FIELD_AUTHORITY_DOMAIN.PRODUCT_IDENTITY_LIGHT,
    ...CATALOG_BULK_QUERY_DEFINITIONS.PRODUCT_IDENTITY_LIGHT,
    description: "Low-cost product identity and updatedAt validation.",
  },
};

export const TRACKED_METAFIELD_KEYS = {
  PRODUCT: new Set([
    "custom.google_shopping_category",
    "custom.google_shopping_custom_label_0",
    "custom.google_shopping_custom_label_1",
    "custom.google_shopping_custom_label_2",
    "custom.google_shopping_custom_label_3",
    "custom.google_shopping_custom_label_4",
    "google.custom_label_0",
    "google.custom_label_1",
    "google.custom_label_2",
    "google.custom_label_3",
    "google.custom_label_4",
  ]),
  VARIANT: new Set([
    "custom.google_shopping_color",
    "custom.google_shopping_material",
    "custom.google_shopping_size",
    "custom.google_shopping_mpn",
  ]),
};

const buildMetafieldKey = ({ namespace, key }) =>
  `${String(namespace || "").trim()}.${String(key || "").trim()}`;

export const isTrackedMetafieldAllowed = ({
  ownerType,
  namespace,
  key,
}) => {
  const owner = String(ownerType || "").trim().toUpperCase();
  const allowed = TRACKED_METAFIELD_KEYS[owner];

  if (!allowed) {
    return false;
  }

  return allowed.has(buildMetafieldKey({ namespace, key }));
};

const FIELD_AUTHORITY = {
  id: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  title: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  handle: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  status: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  productType: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  vendor: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  tags: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  templateSuffix: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  createdAt: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  updatedAt: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  publishedAt: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  onlineStoreUrl: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  descriptionHtml: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  seoTitle: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  seoDescription: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  totalInventory: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  categoryId: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  categoryName: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  options: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  option1Name: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  option2Name: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  option3Name: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  variantId: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  variantTitle: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  sku: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  barcode: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  price: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  compareAtPrice: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  position: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  taxable: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  taxCode: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  inventoryPolicy: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  selectedOptions: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  inventoryItemId: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  tracked: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  requiresShipping: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  countryCodeOfOrigin: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  harmonizedSystemCode: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  unitCost: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  weight: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  weightUnit: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,

  collectionId: FIELD_AUTHORITY_DOMAIN.COLLECTION_MEMBERSHIP,
  collectionTitle: FIELD_AUTHORITY_DOMAIN.COLLECTION_MEMBERSHIP,
  collectionHandle: FIELD_AUTHORITY_DOMAIN.COLLECTION_MEMBERSHIP,
  collections: FIELD_AUTHORITY_DOMAIN.COLLECTION_MEMBERSHIP,

  // Product-level google shopping attributes from baseline sync.
  googleShoppingEnabled: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  googleShoppingCondition: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  googleShoppingGender: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  googleShoppingAgeGroup: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  googleShoppingSizeSystem: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  googleShoppingSizeType: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  googleShoppingCustomProduct: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,

  // Category attribute columns from baseline sync.
  categoryAgeGroup: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  categoryColor: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  categoryFabric: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  categoryFit: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  categorySize: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  categoryTargetGender: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,
  categoryWaistRise: FIELD_AUTHORITY_DOMAIN.PRODUCT_VARIANT_BASELINE,

  // Denormalized from product tracked metafields (custom.google_shopping_* on products).
  googleShoppingCategory: FIELD_AUTHORITY_DOMAIN.PRODUCT_TRACKED_METAFIELDS,
  googleShoppingCustomLabel0: FIELD_AUTHORITY_DOMAIN.PRODUCT_TRACKED_METAFIELDS,
  googleShoppingCustomLabel1: FIELD_AUTHORITY_DOMAIN.PRODUCT_TRACKED_METAFIELDS,
  googleShoppingCustomLabel2: FIELD_AUTHORITY_DOMAIN.PRODUCT_TRACKED_METAFIELDS,
  googleShoppingCustomLabel3: FIELD_AUTHORITY_DOMAIN.PRODUCT_TRACKED_METAFIELDS,
  googleShoppingCustomLabel4: FIELD_AUTHORITY_DOMAIN.PRODUCT_TRACKED_METAFIELDS,

  // Denormalized from variant tracked metafields (custom.google_shopping_* on variants).
  googleShoppingColor: FIELD_AUTHORITY_DOMAIN.VARIANT_TRACKED_METAFIELDS,
  googleShoppingMaterial: FIELD_AUTHORITY_DOMAIN.VARIANT_TRACKED_METAFIELDS,
  googleShoppingSize: FIELD_AUTHORITY_DOMAIN.VARIANT_TRACKED_METAFIELDS,
  googleShoppingMpn: FIELD_AUTHORITY_DOMAIN.VARIANT_TRACKED_METAFIELDS,

  productMetafields: FIELD_AUTHORITY_DOMAIN.PRODUCT_TRACKED_METAFIELDS,
  productMetafieldNamespace: FIELD_AUTHORITY_DOMAIN.PRODUCT_TRACKED_METAFIELDS,
  productMetafieldKey: FIELD_AUTHORITY_DOMAIN.PRODUCT_TRACKED_METAFIELDS,
  productMetafieldType: FIELD_AUTHORITY_DOMAIN.PRODUCT_TRACKED_METAFIELDS,
  productMetafieldValue: FIELD_AUTHORITY_DOMAIN.PRODUCT_TRACKED_METAFIELDS,

  variantMetafields: FIELD_AUTHORITY_DOMAIN.VARIANT_TRACKED_METAFIELDS,
  variantMetafieldNamespace: FIELD_AUTHORITY_DOMAIN.VARIANT_TRACKED_METAFIELDS,
  variantMetafieldKey: FIELD_AUTHORITY_DOMAIN.VARIANT_TRACKED_METAFIELDS,
  variantMetafieldType: FIELD_AUTHORITY_DOMAIN.VARIANT_TRACKED_METAFIELDS,
  variantMetafieldValue: FIELD_AUTHORITY_DOMAIN.VARIANT_TRACKED_METAFIELDS,
};

const PRODUCT_TYPE_ONLY_FIELDS = new Set(["productType"]);

const normalizeField = (field) => {
  if (!field || typeof field !== "string") {
    throw new Error("field is required");
  }

  return field.trim();
};

const assertAuthorityDomain = (authorityDomain) => {
  if (!AUTHORITY_DEFINITIONS[authorityDomain]) {
    throw new Error(`Unknown authority domain: ${authorityDomain}`);
  }
};

export const getFieldAuthority = (field, options = {}) => {
  const normalizedField = normalizeField(field);

  if (
    options.preferLightweightProductType === true &&
    PRODUCT_TYPE_ONLY_FIELDS.has(normalizedField)
  ) {
    return FIELD_AUTHORITY_DOMAIN.PRODUCT_TYPE_ONLY;
  }

  return FIELD_AUTHORITY[normalizedField] || null;
};

export const isFieldSupportedByAuthority = (field) => {
  return !!getFieldAuthority(field);
};

export const getBulkQueryForAuthority = (authorityDomain) => {
  assertAuthorityDomain(authorityDomain);

  return AUTHORITY_DEFINITIONS[authorityDomain].query;
};

export const getBulkQueryMetadataForAuthority = (authorityDomain) => {
  assertAuthorityDomain(authorityDomain);

  const definition = AUTHORITY_DEFINITIONS[authorityDomain];
  return {
    pipelineVersion: definition.pipelineVersion,
    schemaVersion: definition.schemaVersion,
  };
};

export const getAuthorityDefinition = (authorityDomain) => {
  assertAuthorityDomain(authorityDomain);

  return { ...AUTHORITY_DEFINITIONS[authorityDomain] };
};

export const getFieldsForAuthority = (authorityDomain) => {
  assertAuthorityDomain(authorityDomain);

  return Object.entries(FIELD_AUTHORITY)
    .filter(([, authority]) => authority === authorityDomain)
    .map(([field]) => field)
    .sort();
};

export const listFieldAuthorities = () => {
  return Object.values(FIELD_AUTHORITY_DOMAIN).map((authorityDomain) => ({
    ...getAuthorityDefinition(authorityDomain),
    fields: getFieldsForAuthority(authorityDomain),
  }));
};

export const groupFieldsByAuthority = (fields, options = {}) => {
  if (!Array.isArray(fields)) {
    throw new Error("fields must be an array");
  }

  return fields.reduce((grouped, field) => {
    const authority = getFieldAuthority(field, options);
    const bucket = authority || "UNSUPPORTED";

    return {
      ...grouped,
      [bucket]: [...(grouped[bucket] || []), field],
    };
  }, {});
};
