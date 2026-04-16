import * as inventoryLevelRepository from "../repositories/inventoryLevelRepository.js";
import * as domainFreshnessService from "../services/sync/domainFreshnessService.js";
import * as syncRunService from "../services/sync/syncRunService.js";
import {
  downloadJsonlStream,
  parseJsonlStream,
} from "../utils/jsonlStreamUtils.js";
import { logBatchEvent } from "../utils/batchObservability.js";

/**
 * Inventory level ingest worker.
 *
 * Future-facing worker for location-level inventory.
 * Current variant-level inventory remains available through inventoryLevelRepository.
 */

const DEFAULT_BATCH_SIZE = 1000;

const assertShop = (shop) => {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required");
  }
};

const assertBatchId = (catalogBatchId) => {
  if (!catalogBatchId || typeof catalogBatchId !== "string") {
    throw new Error("catalogBatchId is required");
  }
};

const assertUrl = (sourceUrl) => {
  if (!sourceUrl || typeof sourceUrl !== "string") {
    throw new Error("sourceUrl is required");
  }
};

const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toSafeDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeInventoryLevelRow = ({ shop, catalogBatchId, json }) => {
  if (!json || json.__typename !== "InventoryLevel") {
    return null;
  }

  const inventoryItemId = json.inventoryItem?.id || json.inventoryItemId || null;
  const locationId = json.__parentId || json.location?.id || json.locationId || null;

  if (!inventoryItemId || !locationId) {
    return null;
  }

  return {
    shop,
    catalogBatchId,
    inventoryItemId,
    locationId,
    available: toSafeNumber(json.available),
    committed: toSafeNumber(json.committed),
    incoming: toSafeNumber(json.incoming),
    onHand: toSafeNumber(json.onHand),
    sourceUpdatedAt: toSafeDate(json.updatedAt),
    sourceEventAt: toSafeDate(json.sourceEventAt || json.updatedAt),
  };
};

const parseAndStageInventoryLevels = async ({
  dataStream,
  shop,
  catalogBatchId,
  batchSize = DEFAULT_BATCH_SIZE,
}) => {
  let batch = [];
  let recordCount = 0;

  const flush = async () => {
    if (batch.length === 0) return;

    const current = batch;
    batch = [];

    await inventoryLevelRepository.createManyInventoryLevels(current);
    recordCount += current.length;
  };

  for await (const { value: json } of parseJsonlStream(dataStream)) {
    const row = normalizeInventoryLevelRow({
      shop,
      catalogBatchId,
      json,
    });

    if (!row) continue;

    batch.push(row);

    if (batch.length >= batchSize) {
      await flush();
    }
  }

  await flush();

  return { recordCount };
};

export const ingestInventoryLevelArtifact = async ({
  shop,
  sourceUrl,
  catalogBatchId,
  syncRunId = null,
}) => {
  assertShop(shop);
  assertUrl(sourceUrl);
  assertBatchId(catalogBatchId);

  try {
    logBatchEvent("catalog_batch_ingest_write", {
      shop,
      syncRunId,
      newCatalogBatchId: catalogBatchId,
      resolvedCatalogBatchId: catalogBatchId,
      path: "ingest",
      extra: {
        source: "inventory_level_artifact",
      },
    });

    if (syncRunId) {
      await syncRunService.heartbeatSyncRun({
        syncRunId,
        stage: "INVENTORY_LEVEL_STAGING",
        responseUrl: sourceUrl,
      });
    }

    await inventoryLevelRepository.deleteInventoryLevelsByBatch({
      shop,
      catalogBatchId,
    });

    const dataStream = await downloadJsonlStream({
      sourceUrl,
      errorLabel: "inventory artifact",
    });
    const { recordCount } = await parseAndStageInventoryLevels({
      dataStream,
      shop,
      catalogBatchId,
    });

    logBatchEvent("catalog_batch_ingest_write", {
      shop,
      syncRunId,
      newCatalogBatchId: catalogBatchId,
      resolvedCatalogBatchId: catalogBatchId,
      path: "ingest",
      extra: {
        source: "inventory_level_artifact",
        recordCount,
      },
    });

    await domainFreshnessService.markDomainFresh({
      shop,
      domain: domainFreshnessService.FRESHNESS_DOMAIN.INVENTORY,
      lastFreshAt: new Date(),
      source: "INVENTORY_LEVEL_INGEST",
      sourceRunId: syncRunId,
      catalogBatchId,
      details: {
        recordCount,
      },
    }).catch(() => {});

    if (syncRunId) {
      await syncRunService.markSyncRunCompleted({
        syncRunId,
        stage: "INVENTORY_LEVEL_COMPLETED",
        rowCount: recordCount,
        catalogBatchId,
        responseUrl: sourceUrl,
      }).catch(() => {});
    }

    return {
      success: true,
      shop,
      catalogBatchId,
      recordCount,
    };
  } catch (error) {
    if (syncRunId) {
      await syncRunService.markSyncRunFailed({
        syncRunId,
        stage: "INVENTORY_LEVEL_FAILED",
        failureCode: error.code || "INVENTORY_LEVEL_INGEST_FAILED",
        failureMessage: error.message || "Inventory level ingest failed",
        responseUrl: sourceUrl,
      }).catch(() => {});
    }

    await domainFreshnessService.markDomainStale({
      shop,
      domain: domainFreshnessService.FRESHNESS_DOMAIN.INVENTORY,
      staleReason: error.message || "Inventory level ingest failed",
      repairRequired: false,
      source: "INVENTORY_LEVEL_INGEST",
      sourceRunId: syncRunId,
      catalogBatchId,
    }).catch(() => {});

    throw error;
  }
};

export const processInventoryLevelIngestJob = ingestInventoryLevelArtifact;
