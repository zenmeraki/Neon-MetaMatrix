import { getCurrentBulkOperationStatus } from "../../modules/bulkOperations/bulkOperationHelper.js";
import { prisma } from "../../config/database.js";
import { getStoreMirrorState } from "../mirrorHealthService.js";
import { OPERATION_TYPES } from "../../constants/operationTypes.js";
import { storeExecutionPolicyService } from "./storeExecutionPolicyService.js";
import { stableHash } from "../../utils/idempotencyKey.js";
import { blastRadiusService } from "./blastRadiusService.js";
import { catalogAnomalyService } from "./catalogAnomalyService.js";
import {
  getFrozenTargetSnapshotSummary,
  resolveCanonicalProductTarget,
} from "../productService/productTargetingService.js";

function preflightError(code, message, details = null) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = 409;
  error.details = details;
  return error;
}

function normalizeOperationField(body = {}) {
  const raw =
    body?.editedField ||
    body?.field ||
    body?.intent?.operation?.field ||
    body?.rawIntent?.operation?.field ||
    "";
  return String(raw).trim();
}

function isInventoryOperationField(field) {
  return new Set(["inventory", "inventoryQuantity", "variant.inventoryQuantity"]).has(
    String(field || "").trim(),
  );
}

function assertInventoryLocationPreflight(body = {}) {
  const field = normalizeOperationField(body);
  if (!isInventoryOperationField(field)) return;

  const locationId = String(
    body?.locationId ??
      body?.intent?.operation?.locationId ??
      body?.rawIntent?.operation?.locationId ??
      "",
  ).trim();

  if (!locationId) {
    throw preflightError(
      "INVENTORY_LOCATION_REQUIRED",
      "Inventory edits require a location id before plan creation.",
      { field },
    );
  }
}

const WRITE_OPERATIONS_REQUIRING_FROZEN_TARGET = new Set([
  OPERATION_TYPES.BULK_EDIT,
  OPERATION_TYPES.EXPORT,
]);

function assertPlanValid(subscription = {}) {
  if (subscription?.isCreditUser === true) return;

  const status = String(subscription?.status || "FREE").toUpperCase();
  if (!["ACTIVE", "PENDING", "FREE"].includes(status)) {
    throw preflightError(
      "PLAN_INACTIVE",
      "Subscription is inactive. Operation is blocked before execution.",
      { status },
    );
  }
}

async function resolveTargetForPreflight({ shop, filterParams, targetSnapshotId }) {
  const normalizedTargetSnapshotId =
    typeof targetSnapshotId === "string" ? targetSnapshotId.trim() : "";
  if (normalizedTargetSnapshotId) {
    const target = await getFrozenTargetSnapshotSummary({
      ownerType: "AD_HOC_PRODUCT_TARGET",
      ownerId: normalizedTargetSnapshotId,
      shop,
    });
    return { ...target, source: "frozen_snapshot", targetSnapshotId: normalizedTargetSnapshotId };
  }

  const target = await resolveCanonicalProductTarget({
    shop,
    filterParams: Array.isArray(filterParams) ? filterParams : [],
    queryParams: { page: 1, limit: 20 },
    sampleLimit: 20,
  });
  return { ...target, source: "live_resolved", targetSnapshotId: null };
}

function assertFrozenTargetRequired({ operationType, targetSnapshotId }) {
  const normalizedOperationType = String(operationType || "").trim().toUpperCase();
  const normalizedTargetSnapshotId =
    typeof targetSnapshotId === "string" ? targetSnapshotId.trim() : "";

  if (
    WRITE_OPERATIONS_REQUIRING_FROZEN_TARGET.has(normalizedOperationType) &&
    !normalizedTargetSnapshotId
  ) {
    throw preflightError(
      "IMMUTABLE_TARGET_REQUIRED",
      "Write execution requires a frozen target snapshot",
      { operationType: normalizedOperationType },
    );
  }
}

function assertNoBlockingAnomalies(anomalies) {
  if (!anomalies?.blocksExecution) return;
  throw preflightError(
    "CATALOG_ANOMALIES_BLOCK_EXECUTION",
    "Catalog anomalies detected. Fix blockers before execution.",
    {
      anomalies,
    },
  );
}

async function assertSnapshotActive(shop, mirrorBatchId) {
  const state = await getStoreMirrorState(shop);
  if (!state?.activeMirrorBatchId) {
    throw preflightError("MIRROR_NOT_READY", "Mirror is not ready");
  }
  if (!mirrorBatchId || state.activeMirrorBatchId !== mirrorBatchId) {
    throw preflightError(
      "SNAPSHOT_NOT_ACTIVE",
      "Target snapshot is not from the active mirror batch",
      {
        activeMirrorBatchId: state.activeMirrorBatchId,
        targetMirrorBatchId: mirrorBatchId || null,
      },
    );
  }
}

function buildSnapshotFingerprint({
  shop,
  mirrorBatchId,
  targetCount,
  targetSnapshotId = null,
  filterParams = [],
}) {
  return stableHash({
    shop,
    mirrorBatchId: mirrorBatchId || null,
    targetCount: Number(targetCount || 0),
    targetSnapshotId: targetSnapshotId || null,
    filterParams: Array.isArray(filterParams) ? filterParams : [],
  });
}

function resolveAuthoritativeFingerprint(target, fallbackFingerprint) {
  if (typeof target?.plannerFingerprint === "string" && target.plannerFingerprint.trim()) {
    return target.plannerFingerprint.trim();
  }
  return fallbackFingerprint;
}

async function assertTargetCountStable({ shop, filterParams, targetSnapshotId, initialTarget }) {
  const verifyTarget = await resolveTargetForPreflight({
    shop,
    filterParams,
    targetSnapshotId,
  });

  if (
    Number(initialTarget?.count || 0) !== Number(verifyTarget?.count || 0) ||
    String(initialTarget?.mirrorBatchId || "") !== String(verifyTarget?.mirrorBatchId || "")
  ) {
    throw preflightError(
      "TARGET_COUNT_UNSTABLE",
      "Target changed during preflight. Please retry.",
      {
        initialCount: Number(initialTarget?.count || 0),
        verifyCount: Number(verifyTarget?.count || 0),
        initialMirrorBatchId: initialTarget?.mirrorBatchId || null,
        verifyMirrorBatchId: verifyTarget?.mirrorBatchId || null,
      },
    );
  }
}

async function assertNoActiveExportConflict(shop) {
  const activeExport = await prisma.exportJob.findFirst({
    where: {
      shop,
      OR: [
        { status: "PROCESSING" },
        { executionState: { in: ["running", "finalizing"] } },
      ],
    },
    select: { id: true },
  });

  if (activeExport) {
    throw preflightError(
      "EXPORT_CONFLICT_ACTIVE",
      "Another export is already running for this shop",
      { exportJobId: activeExport.id },
    );
  }
}

async function assertShopifyBulkSlot(session) {
  const { status } = await getCurrentBulkOperationStatus(session);
  if (status === "RUNNING") {
    throw preflightError(
      "SHOPIFY_BULK_SLOT_UNAVAILABLE",
      "Another Shopify bulk operation is already running",
    );
  }
}

export const preflightExecutionService = {
  async runSharedPreflight({
    session,
    subscription = {},
    operationType,
    filterParams = [],
    targetSnapshotId = null,
    requireShopifyBulkSlot = false,
  }) {
    const shop = session?.shop;
    if (!shop) {
      throw preflightError("SESSION_SHOP_REQUIRED", "Session shop is required");
    }

    assertPlanValid(subscription);

    if (operationType) {
      const policy = await storeExecutionPolicyService.canStartOperation({
        shop,
        operationType,
      });
      if (!policy.allowed) {
        throw preflightError(policy.reason || "PRECHECK_FAILED", policy.message);
      }
    }

    assertFrozenTargetRequired({ operationType, targetSnapshotId });

    const target = await resolveTargetForPreflight({
      shop,
      filterParams,
      targetSnapshotId,
    });

    await assertSnapshotActive(shop, target.mirrorBatchId);
    await assertTargetCountStable({
      shop,
      filterParams,
      targetSnapshotId,
      initialTarget: target,
    });

    if (requireShopifyBulkSlot) {
      await assertShopifyBulkSlot(session);
    }

    const snapshotFingerprint = buildSnapshotFingerprint({
      shop,
      mirrorBatchId: target.mirrorBatchId,
      targetCount: target.count,
      targetSnapshotId,
      filterParams,
    });
    const authoritativeFingerprint = resolveAuthoritativeFingerprint(
      target,
      snapshotFingerprint,
    );

    return {
      ok: true,
      shop,
      targetCount: Number(target.count || 0),
      mirrorBatchId: target.mirrorBatchId || null,
      snapshotFingerprint: authoritativeFingerprint,
      canonicalQueryHash: target?.canonicalQueryHash || null,
      plannerVersion: target?.plannerVersion ?? null,
      canonicalOrderBy: target?.canonicalOrderBy || null,
      targetSnapshotId: targetSnapshotId || null,
    };
  },

  async runBulkEditPreflight({
    session,
    subscription = {},
    body = {},
  }) {
    assertInventoryLocationPreflight(body);

    const normalizedTargetSnapshotId =
      typeof body?.targetSnapshotId === "string"
        ? body.targetSnapshotId.trim()
        : "";
    if (!normalizedTargetSnapshotId) {
      throw preflightError(
        "IMMUTABLE_TARGET_REQUIRED",
        "Bulk edit execution requires a frozen target snapshot.",
      );
    }

    const preflight = await this.runSharedPreflight({
      session,
      subscription,
      operationType: OPERATION_TYPES.BULK_EDIT,
      filterParams: body.filterParams,
      targetSnapshotId: normalizedTargetSnapshotId,
      requireShopifyBulkSlot: true,
    });

    const editedField = String(body?.editedField || body?.field || "");
    const blastRadius = blastRadiusService.buildEditBlastRadius({
      targetCount: preflight.targetCount,
      field: editedField,
      filterParams: body?.filterParams,
    });
    const anomalies = await catalogAnomalyService.detectForFrozenTarget({
      shop: preflight.shop,
      targetSnapshotId: normalizedTargetSnapshotId,
      ownerType: "AD_HOC_PRODUCT_TARGET",
    });
    assertNoBlockingAnomalies(anomalies);
    if (
      blastRadius.requiresExplicitConfirmation &&
      !blastRadiusService.isHighRiskConfirmed(
        body?.riskConfirmation ?? body?.riskAcknowledged,
      )
    ) {
      throw preflightError(
        "BLAST_RADIUS_CONFIRMATION_REQUIRED",
        "High-risk bulk edit requires explicit confirmation.",
        {
          blastRadius,
        },
      );
    }

    if (editedField === "deleteProducts") {
      throw preflightError(
        "UNDO_SNAPSHOT_NOT_AVAILABLE",
        "Undo snapshot cannot be created for delete operations",
      );
    }

    return {
      ...preflight,
      blastRadius,
      anomalies,
      undoSnapshotCreatable: true,
    };
  },

  async runExportPreflight({
    session,
    subscription = {},
    filterParams = [],
    targetSnapshotId = null,
    fields = [],
    riskConfirmation = null,
  }) {
    const preflight = await this.runSharedPreflight({
      session,
      subscription,
      operationType: OPERATION_TYPES.EXPORT,
      filterParams,
      targetSnapshotId,
      requireShopifyBulkSlot: false,
    });
    const shop = preflight.shop;
    await assertNoActiveExportConflict(shop);
    const anomalies = await catalogAnomalyService.detectForFrozenTarget({
      shop: preflight.shop,
      targetSnapshotId,
      ownerType: "AD_HOC_PRODUCT_TARGET",
    });
    assertNoBlockingAnomalies(anomalies);
    const blastRadius = blastRadiusService.buildExportBlastRadius({
      targetCount: preflight.targetCount,
      fields,
      filterParams,
    });
    if (
      blastRadius.requiresExplicitConfirmation &&
      !blastRadiusService.isHighRiskConfirmed(riskConfirmation)
    ) {
      throw preflightError(
        "BLAST_RADIUS_CONFIRMATION_REQUIRED",
        "High-risk export requires explicit confirmation.",
        {
          blastRadius,
        },
      );
    }

    return {
      ...preflight,
      blastRadius,
      anomalies,
    };
  },
};
