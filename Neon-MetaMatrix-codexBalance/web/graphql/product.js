export const graphqlProductCoreBulkSyncQuery = `{
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

export const graphqlVariantBulkSyncQuery = `{
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

        product {
          id
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

export const graphqlProductCollectionMembershipBulkSyncQuery = `{
  products {
    edges {
      node {
        __typename
        id

        collections {
          edges {
            node {
              __typename
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
}`;

export const graphqlProductTrackedMetafieldsBulkSyncQuery = `{
  products {
    edges {
      node {
        __typename
        id

        metafields {
          edges {
            node {
              __typename
              namespace
              key
              type
              value
              updatedAt
            }
          }
        }
      }
    }
  }
}`;

// Backward-compatible alias. New sync orchestration should run the domain queries
// separately instead of rebuilding a single product+variant+collection+metafield query.
export const graphqlProductsBulkSyncQuery = graphqlProductCoreBulkSyncQuery;
