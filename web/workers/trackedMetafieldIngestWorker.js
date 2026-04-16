import * as trackedMetafieldRepository from "../repositories/trackedMetafieldRepository.js";
import * as domainFreshnessService from "../services/sync/domainFreshnessService.js";
import * as syncRunService from "../services/sync/syncRunService.js";
import {
  downloadJsonlStream,
  parseJsonlStream,
} from "../utils/jsonlStreamUtils.js";
import { logBatchEvent } from "../utils/batchObservability.js";
import { isTrackedMetafieldAllowed } from "../services/sync/fieldAuthorityService.js";

/**
 * Tracked metafield ingest worker.
 *
 * Future-facing worker for normalized tracked metafields.
 * It is safe to add now, but using it requires the trackedMetafield Prisma model.
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

const toSafeDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeMetafieldRow = ({
  shop,
  catalogBatchId,
  ownerType,
  ownerId,
  parent = null,
  json,
}) => {
  if (!json || json.__typename !== "Metafield") {
    return null;
  }

  if (!ownerId || !json.namespace || !json.key) {
    return null;
  }

  if (
    !isTrackedMetafieldAllowed({
      ownerType,
      namespace: json.namespace,
      key: json.key,
    })
  ) {
    return null;
  }

  return {
    shop,
    catalogBatchId,
    ownerType,
    ownerId,
    productId: ownerType === "VARIANT" ? parent?.productId || null : null,
    namespace: json.namespace,
    key: json.key,
    type: json.type || null,
    value: json.value || null,
    sourceUpdatedAt: toSafeDate(
      json.updatedAt || parent?.updatedAt || parent?.productUpdatedAt,
    ),
    sourceEventAt: toSafeDate(
      json.sourceEventAt ||
        json.updatedAt ||
        parent?.updatedAt ||
        parent?.productUpdatedAt,
    ),
  };
};

const inferOwnerType = (rootTypename) => {
  if (rootTypename === "ProductVariant") return "VARIANT";
  return "PRODUCT";
};

const parseAndStageMetafields = async ({
  dataStream,
  shop,
  catalogBatchId,
  ownerType,
  batchSize = DEFAULT_BATCH_SIZE,
}) => {
  const parentById = new Map();
  let batch = [];
  let recordCount = 0;

  const flush = async () => {
    if (batch.length === 0) return;

    const current = batch;
    batch = [];

    await trackedMetafieldRepository.createManyTrackedMetafields(current);
    recordCount += current.length;
  };

  for await (const { value: json } of parseJsonlStream(dataStream)) {

    if (!json.__parentId && json.id && json.__typename) {
      parentById.set(json.id, {
        typename: json.__typename,
        productId: json.product?.id || null,
        productUpdatedAt: json.product?.updatedAt || null,
        updatedAt: json.updatedAt || null,
      });
      continue;
    }

    const parent = parentById.get(json.__parentId) || null;
    const resolvedOwnerType =
      ownerType || inferOwnerType(parent?.typename);

    const row = normalizeMetafieldRow({
      shop,
      catalogBatchId,
      ownerType: resolvedOwnerType,
      ownerId: json.__parentId,
      parent,
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

export const ingestTrackedMetafieldArtifact = async ({
  shop,
  sourceUrl,
  catalogBatchId,
  ownerType = null,
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
        source: "tracked_metafield_artifact",
        ownerType,
      },
    });

    if (syncRunId) {
      await syncRunService.heartbeatSyncRun({
        syncRunId,
        stage: "TRACKED_METAFIELD_STAGING",
        responseUrl: sourceUrl,
      });
    }

    await trackedMetafieldRepository.deleteTrackedMetafieldsByBatch({
      shop,
      catalogBatchId,
    });

    const dataStream = await downloadJsonlStream({
      sourceUrl,
      errorLabel: "metafield artifact",
    });
    const { recordCount } = await parseAndStageMetafields({
      dataStream,
      shop,
      catalogBatchId,
      ownerType,
    });

    logBatchEvent("catalog_batch_ingest_write", {
      shop,
      syncRunId,
      newCatalogBatchId: catalogBatchId,
      resolvedCatalogBatchId: catalogBatchId,
      path: "ingest",
      extra: {
        source: "tracked_metafield_artifact",
        ownerType,
        recordCount,
      },
    });

    await domainFreshnessService.markDomainFresh({
      shop,
      domain: domainFreshnessService.FRESHNESS_DOMAIN.METAFIELD,
      lastFreshAt: new Date(),
      source: "TRACKED_METAFIELD_INGEST",
      sourceRunId: syncRunId,
      catalogBatchId,
      details: {
        ownerType,
        recordCount,
      },
    }).catch(() => {});

    if (syncRunId) {
      await syncRunService.markSyncRunCompleted({
        syncRunId,
        stage: "TRACKED_METAFIELD_COMPLETED",
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
        stage: "TRACKED_METAFIELD_FAILED",
        failureCode: error.code || "TRACKED_METAFIELD_INGEST_FAILED",
        failureMessage: error.message || "Tracked metafield ingest failed",
        responseUrl: sourceUrl,
      }).catch(() => {});
    }

    await domainFreshnessService.markDomainStale({
      shop,
      domain: domainFreshnessService.FRESHNESS_DOMAIN.METAFIELD,
      staleReason: error.message || "Tracked metafield ingest failed",
      repairRequired: false,
      source: "TRACKED_METAFIELD_INGEST",
      sourceRunId: syncRunId,
      catalogBatchId,
    }).catch(() => {});

    throw error;
  }
};

export const processTrackedMetafieldIngestJob = ingestTrackedMetafieldArtifact;
