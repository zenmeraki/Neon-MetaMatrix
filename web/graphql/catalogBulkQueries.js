/**
 * Central source of truth for Shopify Admin GraphQL bulk-operation queries.
 *
 * Rules for this file:
 * - Raw GraphQL strings only.
 * - No Prisma.
 * - No session/client creation.
 * - No orchestration logic.
 * - No inline business decisions.
 *
 * Notes:
 * - Bulk queries are intentionally split by authority domain.
 * - Do not collapse these into one giant query; that creates ingestion drift.
 * - Keep these query surfaces stable so downstream JSONL normalizers stay deterministic.
 * - Shopify bulk operations paginate internally. These queries intentionally omit
 *   `first` arguments so Shopify traverses the whole eligible graph; do not add
 *   page-size tuning here unless the downstream JSONL schema version changes.
 * - Expected scale is shop-catalog scale: every product / variant / membership
 *   or active inventory level for the requested authority domain.
 */

/**
 * Mutation wrapper used by bulkOperationRunQuery.
 * Pass one of the exported query strings below as the `query` variable.
 */
export const CATALOG_BULK_PIPELINE_VERSION = "catalog-bulk-v1";

export const CATALOG_BULK_SCHEMA_VERSION = {
  PRODUCT_VARIANT_BASELINE: "product-variant-baseline.v2",
  COLLECTION_MEMBERSHIP: "collection-membership.v2",
  PRODUCT_TRACKED_METAFIELDS: "product-tracked-metafields.v2",
  VARIANT_TRACKED_METAFIELDS: "variant-tracked-metafields.v2",
  PRODUCT_TYPE_ONLY: "product-type-only.v1",
  PRODUCT_IDENTITY_LIGHT: "product-identity-light.v1",
  INVENTORY_LEVEL: "inventory-level.v2",
};

export const RUN_BULK_QUERY_MUTATION = `#graphql
mutation RunBulkQuery($query: String!) {
  bulkOperationRunQuery(query: $query) {
    bulkOperation {
      id
      status
      type
    }
    userErrors {
      field
      message
    }
  }
}
`;

/**
 * Cancel a running or created bulk operation by id.
 */
export const CANCEL_BULK_OPERATION_MUTATION = `#graphql
mutation CancelBulkOperation($id: ID!) {
  bulkOperationCancel(id: $id) {
    bulkOperation {
      id
      status
    }
    userErrors {
      field
      message
    }
  }
}
`;

/**
 * Status lookup by bulk operation id.
 * Prefer this over legacy "current bulk operation" style flows when you already have the id.
 */
export const BULK_OPERATION_STATUS_QUERY = `#graphql
query BulkOperationStatus($id: ID!) {
  node(id: $id) {
    ... on BulkOperation {
      id
      status
      type
      errorCode
      createdAt
      completedAt
      objectCount
      fileSize
      url
      partialDataUrl
    }
  }
}
`;

/**
 * Primary baseline authority:
 * - Product core
 * - Product options
 * - Variant core
 * - InventoryItem core edit/filter fields
 *
 * This is the main mirror feed.
 *
 * Intentional exclusions:
 * - collections
 * - metafields
 * - inventory by location
 * - media-heavy surfaces
 *
 * Those should be handled by dedicated sync domains.
 */
export const PRODUCT_VARIANT_BASELINE_BULK_QUERY_V1 = `#graphql
{
  products {
    edges {
      node {
        __typename
        id
        title
        handle
        status
        productType
        vendor
        tags
        templateSuffix
        createdAt
        updatedAt
        publishedAt
        descriptionHtml

        seo {
          title
          description
        }

        totalInventory

        category {
          id
          name
        }

        options {
          id
          name
          position
          values
        }

        variants {
          edges {
            node {
              __typename
              id
              title
              updatedAt
              sku
              barcode
              price
              compareAtPrice
              position
              taxable
              taxCode
              inventoryPolicy
              inventoryQuantity

              selectedOptions {
                name
                value
              }

              inventoryItem {
                id
                tracked
                requiresShipping
                countryCodeOfOrigin
                harmonizedSystemCode

                unitCost {
                  amount
                  currencyCode
                }

                measurement {
                  weight {
                    value
                    unit
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

/**
 * Collection membership authority.
 *
 * Use this for:
 * - normalized CollectionMirror rows
 * - ProductCollectionMembership rows
 *
 * Do not rely on raw collections JSON for trust-critical targeting.
 */
export const PRODUCT_VARIANT_BASELINE_BULK_QUERY =
  PRODUCT_VARIANT_BASELINE_BULK_QUERY_V1;

export const COLLECTION_MEMBERSHIP_BULK_QUERY_V1 = `#graphql
{
  products {
    edges {
      node {
        id
        collections {
          edges {
            node {
              id
              title
              handle
              updatedAt
            }
          }
        }
      }
    }
  }
}
`;

export const COLLECTION_MEMBERSHIP_BULK_QUERY =
  COLLECTION_MEMBERSHIP_BULK_QUERY_V1;

/**
 * Product tracked metafields authority.
 *
 * Important:
 * - Keep this limited to fields you actually support in UI/filter/export/edit flows.
 * - Do not turn "all metafields" into a permanent trust surface without registry enforcement.
 *
 * Shopify bulk cannot request multiple namespaces in a single metafields connection.
 * This query intentionally limits the payload to the supported custom namespace;
 * the downstream parser allowlist remains the final registry gate.
 */
export const PRODUCT_TRACKED_METAFIELDS_BULK_QUERY_V1 = `#graphql
{
  products {
    edges {
      node {
        id
        metafields(namespace: "custom") {
          edges {
            node {
              namespace
              key
              type
              value
            }
          }
        }
      }
    }
  }
}
`;

export const PRODUCT_TRACKED_METAFIELDS_BULK_QUERY =
  PRODUCT_TRACKED_METAFIELDS_BULK_QUERY_V1;

/**
 * Variant tracked metafields authority.
 *
 * We deliberately anchor this from productVariants instead of nesting deeper under products
 * to keep the variant domain explicit.
 * `updatedAt` is fetched on both the variant and parent product so ingest can
 * preserve freshness signals for webhook-vs-bulk conflict decisions.
 */
export const VARIANT_TRACKED_METAFIELDS_BULK_QUERY_V1 = `#graphql
{
  productVariants {
    edges {
      node {
        id
        updatedAt
        product {
          id
          updatedAt
        }
        metafields(namespace: "custom") {
          edges {
            node {
              namespace
              key
              type
              value
            }
          }
        }
      }
    }
  }
}
`;

export const VARIANT_TRACKED_METAFIELDS_BULK_QUERY =
  VARIANT_TRACKED_METAFIELDS_BULK_QUERY_V1;

/**
 * Lightweight product-type sync query.
 *
 * Keep this separate because your current codebase already has a dedicated product-type sync flow.
 * This avoids over-fetching when only productType needs refresh.
 */
export const PRODUCT_TYPE_ONLY_BULK_QUERY_V1 = `#graphql
{
  products {
    edges {
      node {
        id
        productType
      }
    }
  }
}
`;

export const PRODUCT_TYPE_ONLY_BULK_QUERY =
  PRODUCT_TYPE_ONLY_BULK_QUERY_V1;

/**
 * Optional low-cost product identity query.
 *
 * Useful for health checks, lightweight reconciliations, or validating product counts
 * without pulling the full baseline payload.
 */
export const PRODUCT_IDENTITY_LIGHT_BULK_QUERY_V1 = `#graphql
{
  products {
    edges {
      node {
        id
        updatedAt
      }
    }
  }
}
`;

export const PRODUCT_IDENTITY_LIGHT_BULK_QUERY =
  PRODUCT_IDENTITY_LIGHT_BULK_QUERY_V1;

/**
 * Inventory level authority.
 *
 * Anchored from locations so every active location's inventory is covered.
 * Each InventoryLevel JSONL row carries its parent location through __parentId;
 * the normalizer uses that plus inventoryItem.id as the composite key.
 *
 * Fields committed / incoming / onHand are absent from older API versions;
 * the ingest worker handles them as nullable.
 * If Shopify rejects one of these fields for an older Admin API version, bump
 * this query schema version and use the worker's nullable fallback contract.
 */
export const INVENTORY_LEVEL_BULK_QUERY_V1 = `#graphql
{
  locations {
    edges {
      node {
        __typename
        id

        inventoryLevels {
          edges {
            node {
              __typename
              available
              committed
              incoming
              onHand
              updatedAt

              inventoryItem {
                id
              }
            }
          }
        }
      }
    }
  }
}
`;

export const INVENTORY_LEVEL_BULK_QUERY =
  INVENTORY_LEVEL_BULK_QUERY_V1;

export const CATALOG_BULK_QUERY_DEFINITIONS = {
  PRODUCT_VARIANT_BASELINE: {
    query: PRODUCT_VARIANT_BASELINE_BULK_QUERY_V1,
    pipelineVersion: CATALOG_BULK_PIPELINE_VERSION,
    schemaVersion: CATALOG_BULK_SCHEMA_VERSION.PRODUCT_VARIANT_BASELINE,
  },
  COLLECTION_MEMBERSHIP: {
    query: COLLECTION_MEMBERSHIP_BULK_QUERY_V1,
    pipelineVersion: CATALOG_BULK_PIPELINE_VERSION,
    schemaVersion: CATALOG_BULK_SCHEMA_VERSION.COLLECTION_MEMBERSHIP,
  },
  PRODUCT_TRACKED_METAFIELDS: {
    query: PRODUCT_TRACKED_METAFIELDS_BULK_QUERY_V1,
    pipelineVersion: CATALOG_BULK_PIPELINE_VERSION,
    schemaVersion: CATALOG_BULK_SCHEMA_VERSION.PRODUCT_TRACKED_METAFIELDS,
  },
  VARIANT_TRACKED_METAFIELDS: {
    query: VARIANT_TRACKED_METAFIELDS_BULK_QUERY_V1,
    pipelineVersion: CATALOG_BULK_PIPELINE_VERSION,
    schemaVersion: CATALOG_BULK_SCHEMA_VERSION.VARIANT_TRACKED_METAFIELDS,
  },
  PRODUCT_TYPE_ONLY: {
    query: PRODUCT_TYPE_ONLY_BULK_QUERY_V1,
    pipelineVersion: CATALOG_BULK_PIPELINE_VERSION,
    schemaVersion: CATALOG_BULK_SCHEMA_VERSION.PRODUCT_TYPE_ONLY,
  },
  PRODUCT_IDENTITY_LIGHT: {
    query: PRODUCT_IDENTITY_LIGHT_BULK_QUERY_V1,
    pipelineVersion: CATALOG_BULK_PIPELINE_VERSION,
    schemaVersion: CATALOG_BULK_SCHEMA_VERSION.PRODUCT_IDENTITY_LIGHT,
  },
  INVENTORY_LEVEL: {
    query: INVENTORY_LEVEL_BULK_QUERY_V1,
    pipelineVersion: CATALOG_BULK_PIPELINE_VERSION,
    schemaVersion: CATALOG_BULK_SCHEMA_VERSION.INVENTORY_LEVEL,
  },
};
