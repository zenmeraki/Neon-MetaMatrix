export const graphqlProductsAllFieldQuery = `{
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

        
        metafields(first: 100) {
          edges {
            node {
              __typename
              namespace
              key
              type
              value
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

        collections(first: 100) {
          edges {
            node {
              __typename
              id
              title
            }
          }
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

        variants(first: 250) {
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
  }
}`;
