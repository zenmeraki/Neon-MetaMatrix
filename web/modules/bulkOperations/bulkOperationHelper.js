import { adminGraphqlWithRetry } from "../../utils/shopifyAdminApi.js";

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertSession(session) {
  if (!session?.shop) {
    throw codedError("SHOPIFY_SESSION_REQUIRED");
  }
}

export async function getCurrentBulkOperationStatus(
  session,
  type = "MUTATION",
) {
  assertSession(session);

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
    shop: session.shop,
    operationName: "currentBulkOperation",
    data: {
      query,
      variables: { type },
    },
  });

  return response?.body?.data?.currentBulkOperation || {
    id: null,
    type,
    status: "NONE",
    errorCode: null,
    createdAt: null,
    completedAt: null,
  };
}

export async function cancelBulkOperation(session, bulkOperationId = null) {
  assertSession(session);

  const mutation = `
    mutation BulkOperationCancel($id: ID) {
      bulkOperationCancel(id: $id) {
        bulkOperation {
          id
          type
          status
          errorCode
          createdAt
          completedAt
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
    shop: session.shop,
    operationName: "bulkOperationCancel",
    data: {
      query: mutation,
      variables: {
        id: bulkOperationId || null,
      },
    },
  });

  const payload = response?.body?.data?.bulkOperationCancel;
  const userErrors = payload?.userErrors || [];

  if (userErrors.length) {
    throw codedError(
      "BULK_OPERATION_CANCEL_FAILED",
      userErrors.map((error) => error.message).join("; "),
    );
  }

  return payload?.bulkOperation || null;
}

export async function getBulkEditStatus(bulkOperationId, session) {
  assertSession(session);

  if (!bulkOperationId) {
    throw codedError("BULK_OPERATION_ID_REQUIRED");
  }

  const query = `
    query GetBulkOperationResults($id: ID!) {
      node(id: $id) {
        ... on BulkOperation {
          id
          type
          status
          errorCode
          rootObjectCount
          objectCount
          fileSize
          url
          partialDataUrl
          createdAt
          completedAt
        }
      }
    }
  `;

  const response = await adminGraphqlWithRetry({
    session,
    shop: session.shop,
    operationName: "bulkOperationStatus",
    data: {
      query,
      variables: { id: bulkOperationId },
    },
  });

  const node = response?.body?.data?.node || null;

  if (!node) {
    throw codedError("BULK_OPERATION_NOT_FOUND");
  }

  return node;
}