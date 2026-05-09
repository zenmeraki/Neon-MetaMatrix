import axios from "axios";
import { getSession } from "../utils/sessionHandler.js";
import { syncHistoryRepository } from "../repositories/syncHistoryRepository.js";
import { formatAndSyncProductsToDB } from "./productService/productSyncService.js";

export const catalogIngestionService = {
  async streamJsonlIntoMirror({
    shop,
    syncRunId,
    bulkOperationId,
    url,
    chunkSize = 2_000,
  }) {
    if (!url) {
      throw new Error("SYNC_INGEST_URL_REQUIRED");
    }

    const existingSync = await syncHistoryRepository.findByBulkOperation({
      shop,
      bulkOperationId,
    });

    if (
      existingSync &&
      (existingSync.syncBatchId !== syncRunId ||
        existingSync.status === "completed" ||
        existingSync.stage === "MIRROR_ACTIVATED")
    ) {
      return {
        skipped: true,
        reason: "BULK_OPERATION_ALREADY_INGESTED",
        syncHistoryId: existingSync.id,
        syncBatchId: existingSync.syncBatchId,
      };
    }

    const response = await axios.get(url, {
      responseType: "stream",
      timeout: 120000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    const session = await getSession(shop);

    return formatAndSyncProductsToDB({
      dataStream: response.data,
      shop,
      session,
      syncBatchId: syncRunId,
      syncHistoryId: null,
      chunkSize,
    });
  },
};
