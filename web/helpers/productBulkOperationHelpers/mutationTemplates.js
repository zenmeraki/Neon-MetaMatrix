export const PRODUCT_SET_MODE = {
  PRODUCT_ONLY: "PRODUCT_ONLY",
  PRODUCT_DELETE: "PRODUCT_DELETE",
  VARIANT_ONLY: "VARIANT_ONLY",
  BOTH: "BOTH",
};

export const PRODUCT_DELETE_MUTATION = `
mutation productDelete($id: ID!) {
  productDelete(input: { id: $id }) {
    deletedProductId
    userErrors {
      field
      message
    }
  }
}
`;

export const getProductSetMutation = (mode) => {
  if (mode === PRODUCT_SET_MODE.PRODUCT_DELETE) {
    return PRODUCT_DELETE_MUTATION;
  }

  return `
mutation updateProductAsync($productSet: ProductSetInput!) {
  productSet(input: $productSet) {
    product {
      ${getProductFields(mode)}
    }
    productSetOperation {
      id
      status
      userErrors {
        field
        message
      }
    }
    userErrors {
      field
      message
    }
  }
}
`;
};

const PRODUCT_BASE_FIELDS = `
  id
  title
  descriptionHtml
  vendor
  productType
  handle
  status
  publishedAt
  tags
  category {
    id
    name
  }
  seo {
    title
    description
  }
  options {
    id
    name
    position
    values
  }
`;

const PRODUCT_COLLECTION_FIELDS = `
  collections(first: 100) {
    edges {
      node {
        id
        title
      }
    }
  }
`;

const VARIANT_FIELDS = `
  variants(first: 250) {
    edges {
      node {
        id
        title
        sku
        price
        barcode
        compareAtPrice
        inventoryQuantity
        inventoryPolicy
        taxable
        position
        selectedOptions {
          name
          value
        }
      }
    }
  }
`;

const getProductFields = (mode) => {
  switch (mode) {
    case PRODUCT_SET_MODE.PRODUCT_ONLY:
      return `
        ${PRODUCT_BASE_FIELDS}
      `;

    case PRODUCT_SET_MODE.VARIANT_ONLY:
      return `
        id
      `;

    case PRODUCT_SET_MODE.BOTH:
      return `
        ${PRODUCT_BASE_FIELDS}
      `;

    default:
      throw new Error("Invalid PRODUCT_SET_MODE");
  }
};

export const stagesUploadMutation = `
mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets {
      url
      resourceUrl
      parameters {
        name
        value
      }
    }
    userErrors {
      field
      message
    }
  }
}
`;

export const bulkOperationMutation = `
mutation bulkOperationRunMutation(
  $mutation: String!
  $stagedUploadPath: String!
) {
  bulkOperationRunMutation(
    mutation: $mutation
    stagedUploadPath: $stagedUploadPath
  ) {
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

export const INVENTORY_ADJUST_MUTATION = `
mutation call($input: InventoryAdjustQuantitiesInput!) {
  inventoryAdjustQuantities(input: $input) {
    userErrors {
      field
      message
    }
    inventoryAdjustmentGroup {
      changes {
        name
        delta
        item {
          id
        }
      }
    }
  }
}
`;
