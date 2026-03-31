import { adminGraphqlWithRetry } from "./shopifyAdminApi.js";

export async function getCurrentBulkOperationStatus(
  session,
  type = "MUTATION",
) {
  const query = `
    query CurrentBulkOperation($type: BulkOperationType!) {
      currentBulkOperation(type: $type) {
        id
        type
        status
        errorCode
        createdAt
        completedAt
      }
    }
  `;

  const response = await adminGraphqlWithRetry({
    session,
    shop: session?.shop,
    operationName: "currentBulkOperation",
    data: {
      query,
      variables: { type },
    },
  });

  return response.body?.data?.currentBulkOperation || { status: "COMPLETED" };
}

export async function getBulkEditStatus(bulkOperationId, session) {
  if (!bulkOperationId) {
    throw new Error("Bulk operation ID is required");
  }

  const query = `
    query GetBulkOperationResults($id: ID!) {
      node(id: $id) {
        ... on BulkOperation {
          id
          status
          errorCode
          rootObjectCount
          objectCount
          createdAt
          completedAt
        }
      }
    }
  `;

  const response = await adminGraphqlWithRetry({
    session,
    shop: session?.shop,
    operationName: "bulkOperationStatus",
    data: {
      query,
      variables: { id: bulkOperationId },
    },
  });

  return response.body?.data?.node || null;
}