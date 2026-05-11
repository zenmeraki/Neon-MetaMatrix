import crypto from "crypto";
import { prisma } from "../../config/database.js";
import { getStoreMirrorState } from "../mirrorHealthService.js";
import { compileCanonicalTarget, freezeCanonicalTarget } from "../productService/canonicalTargetingService.js";
import {
  computeFrozenTargetIdsHash,
  getFrozenTargetProductIds,
} from "../productService/productTargetingService.js";
import { verifyExecutionFingerprint } from "./executionFingerprintService.js";
import { preflightExecutionService } from "./preflightExecutionService.js";
import { blastRadiusService } from "./blastRadiusService.js";
import { catalogAnomalyService } from "./catalogAnomalyService.js";
import { stableHash } from "../../utils/idempotencyKey.js";
import {
  assertReplayExecuteRequiresSnapshot,
  codedReplayError,
  diffTargetIds,
} from "./operationReplayContracts.js";

const REPLAY_TARGET_OWNER_TYPE = "AD_HOC_PRODUCT_TARGET";

function codedError(code, message = code, statusCode = 409, details = null) {
  return codedReplayError(code, message, statusCode, details);
}

function createTargetSnapshotId() {
  return `target_${crypto.randomBytes(12).toString("hex")}`;
}

function stableNormalize(value) {
  if (Array.isArray(value)) return value.map((v) => stableNormalize(v));
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableNormalize(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function getReplayFilterParams(sourceIntent) {
  const direct = sourceIntent?.target?.filterParams;
  if (Array.isArray(direct) && direct.length > 0) return direct;
  const runtime = sourceIntent?.target?.runtimeRule?.filterParams;
  if (Array.isArray(runtime) && runtime.length > 0) return runtime;
  return [];
}

function getReplayActionPayload(sourceIntent) {
  return {
    editedField: sourceIntent?.operation?.field || "",
    editedType: sourceIntent?.operation?.editType || "",
    value:
      sourceIntent?.operation?.value?.type === "RAW"
        ? sourceIntent?.operation?.value?.value
        : sourceIntent?.operation?.value?.type === "ARRAY"
        ? sourceIntent?.operation?.value?.items || []
        : "",
    searchKey:
      sourceIntent?.operation?.value?.type === "SEARCH_REPLACE"
        ? sourceIntent?.operation?.value?.search || ""
        : null,
    replaceText:
      sourceIntent?.operation?.value?.type === "SEARCH_REPLACE"
        ? sourceIntent?.operation?.value?.replace || ""
        : null,
    supportValue: sourceIntent?.metadata?.supportValue || null,
    locationId: sourceIntent?.operation?.locationId || null,
  };
}

async function collectFrozenTargetIds({ ownerType, ownerId, shop, limit = 1000 }) {
  const ids = new Set();
  let cursorOrdinal = 0;
  while (true) {
    const page = await getFrozenTargetProductIds({
      ownerType,
      ownerId,
      shop,
      limit,
      cursorOrdinal,
    });
    const rows = Array.isArray(page?.rows) ? page.rows : [];
    for (const row of rows) {
      if (row?.productId) ids.add(String(row.productId));
    }
    if (!rows.length || !page?.hasMore) break;
    cursorOrdinal = Number(page.lastOrdinal || cursorOrdinal);
  }
  return ids;
}

async function loadReplaySourceOperation({ shop, sourceOperationId }) {
  const operation = await prisma.merchantOperation.findFirst({
    where: { id: sourceOperationId, shop },
    select: {
      id: true,
      status: true,
      editHistory: {
        select: {
          id: true,
          summary: true,
          targetSnapshotCount: true,
        },
      },
    },
  });

  if (!operation) {
    throw codedError("REPLAY_SOURCE_OPERATION_NOT_FOUND", "Source operation not found", 404);
  }
  if (operation.status !== "COMPLETED") {
    throw codedError("REPLAY_SOURCE_OPERATION_NOT_COMPLETED", "Only completed operations can be replayed");
  }

  const sourceIntent = operation?.editHistory?.summary?.bulkEditIntent || null;
  if (!sourceIntent) {
    throw codedError("REPLAY_INTENT_NOT_AVAILABLE", "Replay source intent is missing");
  }

  const filterParams = getReplayFilterParams(sourceIntent);
  if (!filterParams.length) {
    throw codedError(
      "REPLAY_FILTER_NOT_AVAILABLE",
      "Replay cannot proceed because source canonical filter is unavailable",
    );
  }

  return { operation, sourceIntent, filterParams };
}

async function freezeReplayTarget({ shop, filterParams }) {
  const mirror = await getStoreMirrorState(shop);
  const activeMirrorBatchId = mirror?.activeMirrorBatchId || null;
  if (!activeMirrorBatchId) {
    throw codedError("MIRROR_NOT_READY", "Active mirror batch is required", 409);
  }

  const plan = await compileCanonicalTarget({
    shop,
    filters: stableNormalize(filterParams),
    sort: "ID",
    operation: "freeze",
    mirrorBatchId: activeMirrorBatchId,
  });
  const targetSnapshotId = createTargetSnapshotId();
  const target = await freezeCanonicalTarget({
    shop,
    plan,
    targetSnapshotId,
  });

  return { targetSnapshotId, target, plan };
}

export const operationReplayService = {
  diffTargetIds,

  assertReplayExecuteRequiresSnapshot,

  async buildReplayPreview({ shop, sourceOperationId }) {
    const { operation, sourceIntent, filterParams } = await loadReplaySourceOperation({
      shop,
      sourceOperationId,
    });

    const { targetSnapshotId, target, plan } = await freezeReplayTarget({ shop, filterParams });

    const previousIds = await collectFrozenTargetIds({
      ownerType: "EDIT_HISTORY",
      ownerId: operation.editHistory.id,
      shop,
    });
    const currentIds = await collectFrozenTargetIds({
      ownerType: REPLAY_TARGET_OWNER_TYPE,
      ownerId: targetSnapshotId,
      shop,
    });
    const drift = diffTargetIds(previousIds, currentIds);
    const replayAction = getReplayActionPayload(sourceIntent);
    const targetIdsHash = await computeFrozenTargetIdsHash({
      ownerType: REPLAY_TARGET_OWNER_TYPE,
      ownerId: targetSnapshotId,
      shop,
    });
    const actionHash = stableHash({
      type: "BULK_EDIT_REPLAY",
      sourceOperationId: operation.id,
      ...replayAction,
    });
    const fieldVersionHash = stableHash({
      type: "BULK_EDIT_FIELD",
      version: 1,
      field: replayAction.editedField,
      editType: replayAction.editedType,
    });
    const executionFingerprint = stableHash({
      shop,
      activeMirrorBatchId: plan?.mirrorBatchId || null,
      canonicalFilterAstHash: plan?.fingerprint || null,
      actionHash,
      targetIdsHash,
      fieldVersionHash,
    });
    const blastRadius = blastRadiusService.buildEditBlastRadius({
      targetCount: Number(target?.count || 0),
      field: replayAction.editedField,
      filterParams,
    });
    const anomalies = await catalogAnomalyService.detectForFrozenTarget({
      shop,
      targetSnapshotId,
      ownerType: REPLAY_TARGET_OWNER_TYPE,
    });

    return {
      sourceOperationId: operation.id,
      targetSnapshotId,
      mirrorBatchId: plan?.mirrorBatchId || preflight?.mirrorBatchId || null,
      plannerFingerprint: plan?.fingerprint || null,
      sqlSignature: plan?.sqlSignature || null,
      querySignature: target?.querySignature || null,
      executionFingerprint,
      preflight: {
        blastRadius,
        anomalies,
      },
      drift,
      replayAction,
      filterParams,
    };
  },

  async buildReplayExecutionPayload({
    shop,
    sourceOperationId,
    targetSnapshotId,
    executionFingerprint,
    riskConfirmation = null,
  }) {
    const normalizedTargetSnapshotId = this.assertReplayExecuteRequiresSnapshot({
      targetSnapshotId,
    });
    const { sourceIntent, filterParams } = await loadReplaySourceOperation({
      shop,
      sourceOperationId,
    });
    const replayAction = getReplayActionPayload(sourceIntent);
    const preflight = await preflightExecutionService.runBulkEditPreflight({
      session: { shop },
      subscription: {},
      body: {
        targetSnapshotId: normalizedTargetSnapshotId,
        filterParams,
        field: replayAction.editedField,
        editedField: replayAction.editedField,
        riskConfirmation,
      },
    });

    return {
      targetSnapshotId: normalizedTargetSnapshotId,
      editedField: replayAction.editedField,
      editedBy: replayAction.editedType,
      value: replayAction.value,
      searchKey: replayAction.searchKey,
      replaceText: replayAction.replaceText,
      supportValue: replayAction.supportValue,
      locationId: replayAction.locationId,
      executionFingerprint,
      replayOfOperationId: sourceOperationId,
      source: "REPLAY",
      filterParams,
      riskConfirmation,
      __preflight: {
        snapshotFingerprint: preflight.snapshotFingerprint,
        mirrorBatchId: preflight.mirrorBatchId,
        targetCount: preflight.targetCount,
        canonicalQueryHash: preflight.canonicalQueryHash || null,
        plannerVersion: preflight.plannerVersion ?? null,
        canonicalOrderBy: preflight.canonicalOrderBy || null,
        blastRadius: preflight.blastRadius || null,
        anomalies: preflight.anomalies || null,
      },
    };
  },
};
