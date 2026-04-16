import * as syncRunService from "../services/sync/syncRunService.js";
import * as catalogIngestFinalizationService from "../services/sync/catalogIngestFinalizationService.js";
import { ingestCatalogJsonl } from "../services/productService/productSyncService.js";
import { downloadJsonlStream } from "../utils/jsonlStreamUtils.js";
import { prisma } from "../Config/database.js";
import { logBatchEvent } from "../utils/batchObservability.js";

/**
 * Catalog baseline ingest worker.
 *
 * Responsibilities:
 * - download a completed Shopify bulk JSONL artifact
 * - hand the stream to the existing product/variant mirror ingester
 * - update SyncRun heartbeat/failure around the ingest boundary
 *
 * Not responsible for:
 * - starting Shopify bulk operations
 * - polling bulk status
 * - parsing domain-specific repair feeds
 */

const assertShop = (shop) => {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required");
  }
};

const assertUrl = (sourceUrl) => {
  if (!sourceUrl || typeof sourceUrl !== "string") {
    throw new Error("sourceUrl is required");
  }
};

/**
 * Ingest one completed baseline artifact.
 */
export const ingestCatalogBaselineArtifact = async ({
  shop,
  session,
  sourceUrl,
  syncBatchId,
  catalogBatchId,
  syncHistoryId = null,
  syncRunId = null,
}) => {
  assertShop(shop);
  assertUrl(sourceUrl);

  const syncRun = syncRunId
    ? await syncRunService.getSyncRunById({ syncRunId }).catch(() => null)
    : null;
  const legacyMirrorBatchId = syncBatchId;
  const resolvedBatchId = syncRun?.catalogBatchId || catalogBatchId;

  if (!resolvedBatchId) {
    throw new Error("catalogBatchId is required");
  }

  try {
    logBatchEvent("catalog_batch_ingest_write", {
      shop,
      syncRunId,
      oldMirrorBatchId: syncBatchId,
      newCatalogBatchId: resolvedBatchId,
      resolvedCatalogBatchId: resolvedBatchId,
      path: "ingest",
      extra: {
        syncHistoryId,
        source: "catalog_baseline_artifact",
      },
    });

    if (syncRunId) {
      await syncRunService.heartbeatSyncRun({
        syncRunId,
        stage: "MIRROR_STAGING",
        responseUrl: sourceUrl,
      });
    }

    const dataStream = await downloadJsonlStream({
      sourceUrl,
      errorLabel: "catalog baseline artifact",
    });

    const result = await ingestCatalogJsonl({
      dataStream,
      shop,
      session,
      syncBatchId: legacyMirrorBatchId || resolvedBatchId,
      catalogBatchId: resolvedBatchId,
      syncHistoryId,
      responseUrl: sourceUrl,
      onIngestHeartbeat:
        syncRunId || syncHistoryId
          ? () =>
              Promise.all([
                syncRunId
                  ? syncRunService.heartbeatSyncRun({
                      syncRunId,
                      stage: "MIRROR_STAGING",
                      responseUrl: sourceUrl,
                    })
                  : null,
                syncHistoryId
                  ? prisma.syncHistory.updateMany({
                      where: {
                        id: syncHistoryId,
                        shop,
                        executionState: "finalizing",
                      },
                      data: { lastHeartbeatAt: new Date() },
                    })
                  : null,
              ])
          : null,
    });

    logBatchEvent("catalog_batch_ingest_write", {
      shop,
      syncRunId,
      oldMirrorBatchId: syncBatchId,
      newCatalogBatchId: resolvedBatchId,
      resolvedCatalogBatchId: resolvedBatchId,
      path: "ingest",
      extra: {
        syncHistoryId,
        source: "catalog_baseline_artifact",
        totalProductsProcessed: result.totalProductsProcessed || 0,
        totalVariantsProcessed: result.totalVariantsProcessed || 0,
      },
    });

    return {
      success: true,
      shop,
      catalogBatchId: resolvedBatchId,
      syncBatchId: legacyMirrorBatchId || resolvedBatchId,
      totalProductsProcessed: result.totalProductsProcessed || 0,
      totalVariantsProcessed: result.totalVariantsProcessed || 0,
    };
  } catch (error) {
    await catalogIngestFinalizationService.markBaselineIngestFailed({
      shop,
      catalogBatchId: resolvedBatchId,
      syncRunId,
      error,
      responseUrl: sourceUrl,
    }).catch(() => {});

    throw error;
  }
};

/**
 * Compatibility alias for queue processors that call a generic worker shape.
 */
export const processCatalogBaselineIngestJob = ingestCatalogBaselineArtifact;
