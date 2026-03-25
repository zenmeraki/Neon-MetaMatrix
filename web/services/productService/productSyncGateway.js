import shopify from "../../shopify.js";
import { graphqlProductsAllFieldQuery } from "../../graphql/product.js";

export async function runProductBulkFetch({ session }) {
  const client = new shopify.api.clients.Graphql({ session });

  const queryBody = String(graphqlProductsAllFieldQuery || "").trim();

  if (!queryBody) {
    throw new Error("graphqlProductsAllFieldQuery is empty");
  }

  const bulkQuery = `
      mutation {
        bulkOperationRunQuery(
          query: ${JSON.stringify(queryBody)}
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

  const response = await client.query({ data: bulkQuery });
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
