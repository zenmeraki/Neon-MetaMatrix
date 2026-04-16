import {
  BULK_OPERATION_STATUS_QUERY,
  CANCEL_BULK_OPERATION_MUTATION,
  RUN_BULK_QUERY_MUTATION,
} from "../graphql/catalogBulkQueries.js";
import { adminGraphqlWithRetry } from "./shopifyAdminApi.js";

/**
 * Normalize the various Shopify GraphQL client response shapes into a single body object.
 */
const extractResponseBody = (response) => response?.body ?? response;

/**
 * Throw on top-level GraphQL errors.
 */
const assertNoGraphqlErrors = (body) => {
  if (!Array.isArray(body?.errors) || body.errors.length === 0) {
    return;
  }

  const message =
    body.errors
      .map((error) => error?.message)
      .filter(Boolean)
      .join(", ") || "Shopify GraphQL request failed";

  throw new Error(message);
};

/**
 * Throw on bulk-operation userErrors.
 */
const assertNoBulkUserErrors = (userErrors, fallbackMessage) => {
  if (!Array.isArray(userErrors) || userErrors.length === 0) {
    return;
  }

  const message =
    userErrors
      .map((error) => error?.message)
      .filter(Boolean)
      .join(", ") || fallbackMessage;

  throw new Error(message);
};

const runAdminGraphql = async ({ session, data, operationName }) => {
  if (!session) {
    throw new Error("Shopify session is required");
  }

  const response = await adminGraphqlWithRetry({
    session,
    shop: session?.shop,
    operationName,
    data,
  });

  const body = extractResponseBody(response);
  assertNoGraphqlErrors(body);

  return body;
};

/**
 * Run a Shopify bulk query.
 *
 * Responsibility:
 * - Shopify API call only
 * - no Prisma writes
 * - no sync orchestration decisions
 */
export const runBulkQuery = async ({ session, query }) => {
  if (!query || typeof query !== "string") {
    throw new Error("Bulk query string is required");
  }

  const body = await runAdminGraphql({
    session,
    operationName: "bulkOperationRunQuery",
    data: {
      query: RUN_BULK_QUERY_MUTATION,
      variables: {
        query,
      },
    },
  });

  const payload = body?.data?.bulkOperationRunQuery;
  const userErrors = payload?.userErrors || [];
  const bulkOperation = payload?.bulkOperation;

  assertNoBulkUserErrors(userErrors, "Failed to start Shopify bulk query");

  if (!bulkOperation?.id) {
    throw new Error("Shopify did not return a bulk operation id");
  }

  return {
    bulkOperationId: bulkOperation.id,
    status: bulkOperation.status || null,
    type: bulkOperation.type || null,
    raw: body,
  };
};

/**
 * Fetch bulk operation status by id.
 *
 * Preferred path when you already know the bulk operation id.
 */
export const getBulkOperationStatusById = async ({
  session,
  bulkOperationId,
}) => {
  if (!bulkOperationId) {
    throw new Error("bulkOperationId is required");
  }

  const body = await runAdminGraphql({
    session,
    operationName: "bulkOperationStatus",
    data: {
      query: BULK_OPERATION_STATUS_QUERY,
      variables: {
        id: bulkOperationId,
      },
    },
  });

  const node = body?.data?.node;

  if (!node) {
    return {
      id: bulkOperationId,
      status: "NOT_FOUND",
      type: null,
      errorCode: null,
      createdAt: null,
      completedAt: null,
      objectCount: 0,
      fileSize: 0,
      url: null,
      partialDataUrl: null,
      raw: body,
    };
  }

  return {
    id: node.id,
    status: node.status || null,
    type: node.type || null,
    errorCode: node.errorCode || null,
    createdAt: node.createdAt || null,
    completedAt: node.completedAt || null,
    objectCount: Number(node.objectCount || 0),
    fileSize: Number(node.fileSize || 0),
    url: node.url || null,
    partialDataUrl: node.partialDataUrl || null,
    raw: body,
  };
};

/**
 * Compatibility wrapper for existing code that wants the result URL.
 */
export const getBulkOperationResultUrl = async ({
  session,
  bulkOperationId,
}) => {
  const status = await getBulkOperationStatusById({
    session,
    bulkOperationId,
  });

  return {
    bulkOperationId: status.id,
    status: status.status,
    url: status.url,
    partialDataUrl: status.partialDataUrl,
    completedAt: status.completedAt,
    objectCount: status.objectCount,
    fileSize: status.fileSize,
  };
};

/**
 * Backward-compatible helper used by the current trackProductSync flow.
 *
 * Existing code expects:
 * getBulkEditStatus(bulkOperationId, session)
 */
export const getBulkEditStatus = async (bulkOperationId, session) => {
  const status = await getBulkOperationStatusById({
    session,
    bulkOperationId,
  });

  return {
    id: status.id,
    status: status.status,
    errorCode: status.errorCode,
    completedAt: status.completedAt,
    objectCount: status.objectCount,
    rootObjectCount: status.objectCount,
    fileSize: status.fileSize,
    url: status.url,
    partialDataUrl: status.partialDataUrl,
    raw: status.raw,
  };
};

/**
 * Cancel a running or created bulk operation.
 *
 * Shopify transitions the operation to CANCELING synchronously and then
 * to CANCELED asynchronously. Poll getBulkOperationStatusById to confirm.
 */
export const cancelBulkOperation = async ({ session, bulkOperationId }) => {
  if (!bulkOperationId) {
    throw new Error("bulkOperationId is required");
  }

  const body = await runAdminGraphql({
    session,
    operationName: "bulkOperationCancel",
    data: {
      query: CANCEL_BULK_OPERATION_MUTATION,
      variables: {
        id: bulkOperationId,
      },
    },
  });

  const payload = body?.data?.bulkOperationCancel;
  const userErrors = payload?.userErrors || [];

  assertNoBulkUserErrors(userErrors, "Failed to cancel bulk operation");

  return {
    bulkOperationId: payload?.bulkOperation?.id ?? bulkOperationId,
    status: payload?.bulkOperation?.status ?? null,
    raw: body,
  };
};

/**
 * Compatibility wrapper for existing code paths that still ask for
 * "current bulk operation status".
 *
 * New code should prefer:
 * - its own SyncRun truth for orchestration
 * - getBulkOperationStatusById(...) when it has the operation id
 *
 * For now, we keep behavior stable by querying currentBulkOperation.
 */
export const getCurrentBulkOperationStatus = async (
  session,
  operationType = "MUTATION",
) => {
  const query = `#graphql
    query GetCurrentBulkOperation($type: BulkOperationType!) {
      currentBulkOperation(type: $type) {
        id
        type
        status
        errorCode
        createdAt
        completedAt
        objectCount
        fileSize
        url
        partialDataUrl
      }
    }
  `;

  const body = await runAdminGraphql({
    session,
    operationName: "currentBulkOperation",
    data: {
      query,
      variables: {
        type: operationType,
      },
    },
  });

  const currentBulkOperation = body?.data?.currentBulkOperation;

  if (!currentBulkOperation) {
    return {
      id: null,
      type: operationType,
      status: "COMPLETED",
      errorCode: null,
      createdAt: null,
      completedAt: null,
      objectCount: 0,
      fileSize: 0,
      url: null,
      partialDataUrl: null,
      raw: body,
    };
  }

  return {
    id: currentBulkOperation.id || null,
    type: currentBulkOperation.type || operationType,
    status: currentBulkOperation.status || null,
    errorCode: currentBulkOperation.errorCode || null,
    createdAt: currentBulkOperation.createdAt || null,
    completedAt: currentBulkOperation.completedAt || null,
    objectCount: Number(currentBulkOperation.objectCount || 0),
    fileSize: Number(currentBulkOperation.fileSize || 0),
    url: currentBulkOperation.url || null,
    partialDataUrl: currentBulkOperation.partialDataUrl || null,
    raw: body,
  };
};
