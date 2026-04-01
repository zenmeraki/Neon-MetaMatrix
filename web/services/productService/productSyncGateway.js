import { graphqlProductsAllFieldQuery } from "../../graphql/product.js";
import { adminGraphqlWithRetry } from "../../utils/shopifyAdminApi.js";

export async function runProductBulkFetch({ session }) {
  const queryBody = String(graphqlProductsAllFieldQuery || "").trim();
  if (!queryBody) {
    throw new Error("graphqlProductsAllFieldQuery is empty");
  }

  const query = `
    mutation RunProductBulkFetch($query: String!) {
      bulkOperationRunQuery(query: $query) {
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

  const response = await adminGraphqlWithRetry({
    session,
    shop: session?.shop,
    operationName: "bulkOperationRunQuery.products",
    data: {
      query,
      variables: {
        query: queryBody,
      },
    },
  });

  const runQueryResult = response.body?.data?.bulkOperationRunQuery;
  const userErrors = runQueryResult?.userErrors || [];
  const bulkOperation = runQueryResult?.bulkOperation;

  if (userErrors.length > 0) {
    throw new Error(JSON.stringify(userErrors));
  }

  if (!bulkOperation?.id) {
    throw new Error("Bulk operation was not created");
  }

  return {
    bulkOperationId: bulkOperation.id,
    responseBody: response.body,
  };
}
