import shopify from "../shopify.js";

export async function getCurrentBulkOperationStatus(
  session,
  type = "MUTATION"
) {
  const query = `
    query {
      currentBulkOperation(type: ${type}) {
        id
        type
        status
        query
      }
    }
  `;
  const client = new shopify.api.clients.Graphql({ session });
  try {
    const response = await client.query({
      data: { query },
    });
   
    return response.body.data.currentBulkOperation || { status: "COMPLETED" };
  } catch (error) {
    throw error;
  }
}

export const getBulkEditStatus = async (bulkOperationId, session) => {
  try {
    if (!bulkOperationId) {
      throw new Error("Bulk operation ID is required");
    }
    const client = new shopify.api.clients.Graphql({ session });

    const query = `
    query GetBulkOperationResults($id: ID!) {
      node(id: $id) {
        ... on BulkOperation {
          id
          status
          errorCode
          rootObjectCount
        }
      }
    }
  `;

    const variables = {
      id: bulkOperationId,
    };

    const response = await client.query({
      data: {
        query,
        variables,
      },
    });
    return response.body.data.node;
  } catch (error) {
    throw new Error("Error in getting bulkoperation status: " + error.message);
  }
};
