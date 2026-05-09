import { graphqlProductsCoreBulkSyncQuery } from "../../graphql/product.js";
import { adminGraphqlWithRetry } from "../../utils/shopifyAdminApi.js";

export async function runProductBulkFetch({ session }) {
  if (typeof graphqlProductsCoreBulkSyncQuery !== "string") {
    throw new Error("graphqlProductsCoreBulkSyncQuery must be a string");
  }

  const queryBody = graphqlProductsCoreBulkSyncQuery.trim();

  if (!queryBody) {
    throw new Error("graphqlProductsCoreBulkSyncQuery is empty");
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
    operationName: "RunProductBulkFetch",
    data: {
      query,
      variables: {
        query: queryBody,
      },
    },
  });

  const responseBody = response?.body;
  if (!responseBody || typeof responseBody !== "object") {
    throw new Error("Shopify bulk operation response was empty");
  }

  const topLevelErrors = Array.isArray(responseBody.errors)
    ? responseBody.errors
    : [];
  if (topLevelErrors.length > 0) {
    throw new Error(topLevelErrors.map((err) => err?.message).filter(Boolean).join(", "));
  }

  const runQueryResult = responseBody?.data?.bulkOperationRunQuery;
  const userErrors = Array.isArray(runQueryResult?.userErrors)
    ? runQueryResult.userErrors
    : [];
  const bulkOperation = runQueryResult?.bulkOperation;

  if (userErrors.length > 0) {
    throw new Error(userErrors.map((err) => err.message).join(", "));
  }

  if (!bulkOperation?.id) {
    throw new Error("Bulk operation was not created");
  }

  if (bulkOperation.status !== "CREATED") {
    throw new Error(
      `Bulk operation was created with unexpected status: ${bulkOperation.status || "UNKNOWN"}`,
    );
  }

  return {
    bulkOperationId: bulkOperation.id,
    status: bulkOperation.status,
  };
}
