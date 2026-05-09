/**
 * product.js
 *
 * Shopify Admin GraphQL product queries.
 *
 * IMPORTANT:
 * - Bulk sync should be domain-split.
 * - Do not rely on nested first:N connections as complete truth.
 * - Product core, variants, collections, and metafields should be reconciled separately.
 * - Media support is featured-media only until a dedicated media domain sync exists.
 * - inventoryQuantity is a summary field only; location-aware inventory requires inventory-level sync.
 */

export const graphqlProductsCoreBulkSyncQuery = `{
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
        onlineStoreUrl
        descriptionHtml

        seo {
          title
          description
        }

        totalInventory

        category {
          __typename
          id
          name
        }

        featuredMedia {
          __typename
          ... on MediaImage {
            id
            alt
            preview {
              image {
                url
                altText
              }
            }
          }
        }

        options {
          __typename
          id
          name
          position
          values
        }
      }
    }
  }
}`;

export const graphqlProductVariantsBulkSyncQuery = `{
  productVariants {
    edges {
      node {
        __typename
        id
        title
        sku
        barcode
        price
        compareAtPrice
        inventoryQuantity
        inventoryPolicy
        taxable
        taxCode
        position
        updatedAt

        product {
          id
          updatedAt
        }

        selectedOptions {
          name
          value
        }

        inventoryItem {
          tracked
          requiresShipping

          unitCost {
            amount
          }

          countryCodeOfOrigin
          harmonizedSystemCode

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
}`;

export const graphqlProductMetafieldsBulkSyncQuery = `{
  products {
    edges {
      node {
        __typename
        id

        metafields(first: 250) {
          edges {
            node {
              __typename
              id
              namespace
              key
              type
              value
              owner {
                ... on Product {
                  id
                }
              }
            }
          }
        }
      }
    }
  }
}`;

export const graphqlProductCollectionsBulkSyncQuery = `{
  collections {
    edges {
      node {
        __typename
        id
        title
        handle
        ruleSet {
          appliedDisjunctively
        }
        updatedAt
        products {
          edges {
            node {
              __typename
              id
            }
          }
        }
      }
    }
  }
}`;

// UNSAFE_FOR_DETERMINISTIC_EXPORT:
// Live Shopify export only. Do not use for preview, execute, undo, replay, or audit exports.
export const graphqlProductsLiveExportQuery = `
  query ProductsExport($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      edges {
        cursor
        node {
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
          onlineStoreUrl
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

          featuredMedia {
            ... on MediaImage {
              id
              alt
              preview {
                image {
                  url
                  altText
                }
              }
            }
          }

          options {
            id
            name
            position
            values
          }

          variants(first: 250) {
            edges {
              node {
                id
                title
                sku
                barcode
                price
                compareAtPrice
                inventoryQuantity
                inventoryPolicy
                taxable
                taxCode
                position

                selectedOptions {
                  name
                  value
                }

                inventoryItem {
                  tracked
                  requiresShipping

                  unitCost {
                    amount
                  }

                  countryCodeOfOrigin
                  harmonizedSystemCode

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

      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const graphqlProductsExportQuery = graphqlProductsLiveExportQuery;
