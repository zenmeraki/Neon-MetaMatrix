import { getSession } from "../utils/sessionHandler.js";
import { getCurrentBulkOperationStatus } from "../modules/bulkOperations/bulkOperationHelper.js";
import { validateCatalogConsistency } from "./catalogConsistencyValidatorService.js";
import { runProductBulkFetch } from "./productService/productSyncGateway.js";

export const catalogSyncService = {
  async startShopifyBulkOperation({ shop, syncRunId }) {
    const session = await getSession(shop);

    if (!session) {
      throw new Error("SHOP_SESSION_NOT_FOUND");
    }

    const currentBulkOperation = await getCurrentBulkOperationStatus(session, "QUERY");

    if (
      currentBulkOperation?.status === "RUNNING" &&
      currentBulkOperation.id !== syncRunId
    ) {
      const error = new Error("A Shopify catalog bulk operation is already running.");
      error.code = "SHOPIFY_BULK_ALREADY_RUNNING";
      error.bulkOperationId = currentBulkOperation.id;
      error.retryable = false;
      throw error;
    }

    const result = await runProductBulkFetch({ session });

    return {
      ...result,
      syncRunId,
    };
  },

  async validateAndActivateSnapshot({ shop, syncRunId }) {
    const result = await validateCatalogConsistency({
      shop,
      mirrorBatchId: syncRunId,
    });

    if (result.status !== "READY") {
      const error = new Error(
        `Catalog consistency validation failed: ${result.errors.join(", ")}`,
      );
      error.code = "CATALOG_INCONSISTENT";
      throw error;
    }

    return result;
  },
};
