import { translatedEditHistoryStatuses } from "../config/constants.js";
import UndoEditService from "../services/productService/productBulkUndoService.js";
import ProductBulkService from "../services/productService/productBulkEditService.js";
import { errorResponse } from "../utils/responseUtils.js";
import { getCurrentBulkOperationStatus } from "../modules/bulkOperations/bulkOperationHelper.js";
import { getUpdatedProducts } from "../helpers/productBulkOperationHelpers/productUpdateHandler.js";
import { FIELD_CONFIGS } from "../helpers/productBulkOperationHelpers/constants.js";
import { createMultiLanguageForFileEdit } from "../utils/googleTranslator.js";
import { addScheduledEditJob } from "../jobs/queues/scheduledEditQueue.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { prisma } from "../config/database.js";
import { merchantOperationRepository } from "../repositories/merchantOperationRepository.js";
import { scheduledEditRunRepository } from "../repositories/scheduledEditRunRepository.js";
import { bulkEditHistoryRepository } from "../repositories/bulkEditHistoryRepository.js";
import { transitionOperation } from "../services/operationTransitionService.js";
import crypto from "crypto";
import {
  BULK_EDIT_EXECUTION_STATES,
  buildPlannedUndoState,
} from "../services/bulkEditExecutionStateService.js";
import {
  getFrozenTargetSnapshotSummary,
  resolveCanonicalProductTarget,
} from "../services/productService/productTargetingService.js";
import { validateBulkEditPayload } from "../validations/bulkEditPayloadValidator.js";
import { getSessionOrThrow } from "../utils/sessionShop.js";
import { recordAuditEvent } from "../services/auditLogService.js";
import { preflightExecutionService } from "../services/execution/preflightExecutionService.js";
import { idempotentCommandService } from "../services/idempotentCommandService.js";
import { classifyRetry } from "../utils/errorTaxonomy.js";
import { normalizeIncomingBulkPayload } from "../utils/canonicalBulkPayload.js";
import { validateCanonicalPayloadEnvelope } from "../validations/canonicalPayloadEnvelopeValidator.js";
import { normalizeLegacyBulkEditPayload } from "../shared/bulkEdit/bulkEditIntent.normalizer.js";
import { validateBulkEditIntent } from "../shared/bulkEdit/bulkEditIntent.validator.js";
import logger from "../utils/loggerUtils.js";
import { BulkEditSource, TargetMode } from "../shared/bulkEdit/bulkEditIntent.schema.js";
import { stableHash } from "../utils/idempotencyKey.js";
import { freezeTargetSnapshotSet } from "../services/bulkExecution/targetSnapshotService.js";
import { buildExecutionPlan } from "../services/bulkExecution/executionPlanService.js";
import { createBulkEditIntent } from "../shared/bulkEdit/bulkEditIntent.schema.js";
const OPERATION_CONFLICT_CODES = new Set([
  "WRITE_OPERATION_RUNNING",
  "PRODUCT_SYNC_RUNNING",
  "CATALOG_NOT_READY",
  "INITIAL_SYNC_REQUIRED",
  "MIRROR_SCHEMA_VERSION_MISMATCH",
  "RATE_LIMIT_EXCEEDED",
  "LOCK_HELD",
  "SCHEDULE_ALREADY_CLAIMED",
  "PLAN_INACTIVE",
  "SNAPSHOT_NOT_ACTIVE",
  "MIRROR_NOT_READY",
  "SHOPIFY_BULK_SLOT_UNAVAILABLE",
  "TARGET_COUNT_UNSTABLE",
  "UNDO_SNAPSHOT_NOT_AVAILABLE",
]);

function operationConflictResponse(code, message) {
  return {
    error: code,
    message:
      message ||
      {
        WRITE_OPERATION_RUNNING: "Another write operation is already running for this store.",
        PRODUCT_SYNC_RUNNING: "Product sync is running for this store.",
        CATALOG_NOT_READY: "Catalog is not ready for write operations.",
        INITIAL_SYNC_REQUIRED: "Initial catalog sync is required before write operations.",
        MIRROR_SCHEMA_VERSION_MISMATCH: "Catalog mirror schema changed. Run a full resync before write operations.",
        RATE_LIMIT_EXCEEDED: "Too many operations were started for this store in the last minute.",
        LOCK_HELD: "Another operation is already running.",
        SCHEDULE_ALREADY_CLAIMED: "This scheduled run has already been claimed.",
      }[code] ||
      "Operation cannot start right now.",
  };
}

function isBulkEditClientError(err) {
  return err?.statusCode === 400 || err?.isClientError === true;
}

function resolveLocalizedTitle(title, lang) {
  if (!title || typeof title !== "object" || Array.isArray(title)) {
    return title;
  }

  return title[lang] || title.en || Object.values(title).find(Boolean) || null;
}

function getScheduledEditLimit(planKey) {
  switch (String(planKey || "").toUpperCase()) {
    case "ADVANCED_MONTHLY":
      return 1000;
    case "PRO_MONTHLY":
      return Infinity;
    case "FREE":
    case "STARTER":
    case "BASIC_MONTHLY":
    case "":
      return 0;
    default:
      return null;
  }
}

function parseUndoIdempotencyKey(rawKey, shop) {
  const key = typeof rawKey === "string" ? rawKey.trim() : "";
  const prefix = `undo:${shop}:`;
  if (!key.startsWith(prefix)) {
    return null;
  }
  const executionId = key.slice(prefix.length).trim();
  if (!executionId) {
    return null;
  }
  if (!/^[a-zA-Z0-9:_-]{8,200}$/.test(executionId)) {
    return null;
  }
  return { key, executionId };
}

function buildCatalogRiskPreview({ count = 0, field = "", filterParams = [] }) {
  const normalizedCount = Number(count || 0);
  const hasDiscountFilter = (Array.isArray(filterParams) ? filterParams : []).some(
    (f) => String(f?.field || "").toLowerCase().includes("compareatprice"),
  );
  const touchesStatus = String(field || "").toLowerCase() === "status";
  const level =
    normalizedCount >= 20000 ? "HIGH RISK" : normalizedCount >= 2000 ? "MEDIUM RISK" : "LOW RISK";

  const impacts = [];
  impacts.push(`${normalizedCount.toLocaleString()} products targeted`);
  if (hasDiscountFilter) impacts.push("Includes products with compare-at-price filters");
  if (touchesStatus) impacts.push("Touches product publish status");
  if (normalizedCount >= 10000) impacts.push("Large variant surface area likely");

  return {
    level,
    impacts,
    summary:
      level === "HIGH RISK"
        ? "This edit touches high-volume catalog surfaces."
        : level === "MEDIUM RISK"
          ? "This edit affects a meaningful part of catalog."
          : "This edit is scoped and low blast-radius.",
  };
}

export const undoEdit = async (req, res) => {
  let session;
  const { id } = req.params;
  let command = null;

  try {
    session = getSessionOrThrow(res);
    const parsedIdempotency = parseUndoIdempotencyKey(
      req.headers["idempotency-key"],
      session.shop,
    );
    if (!parsedIdempotency) {
      return res.status(400).json({
        error: "INVALID_IDEMPOTENCY_KEY",
        message: "Idempotency key must match format undo:{shop}:{executionId}",
      });
    }

    command = await idempotentCommandService.begin({
      shop: session.shop,
      operationType: "UNDO_COMMAND",
      idempotencyKey: parsedIdempotency.key,
      resourceType: "EDIT_HISTORY",
    });
    if (command.enabled && !command.created) {
      if (command.row.status === "COMPLETED") {
        return res.status(200).json({
          id,
          message: "Undo request already accepted",
          retryClass: classifyRetry("IDEMPOTENT_REPLAY_COMPLETED"),
        });
      }
      return res.status(409).json({
        error: "IDEMPOTENT_DUPLICATE_IN_PROGRESS",
        retryClass: classifyRetry("IDEMPOTENT_DUPLICATE_IN_PROGRESS"),
      });
    }
    const ownedHistory = await prisma.editHistory.findFirst({
      where: { id, shop: session.shop },
      select: { id: true },
    });
    if (!ownedHistory) {
      return res.status(404).json(errorResponse("Edit history not found"));
    }

    const service = new UndoEditService(session);
    const result = await service.undoEdit({
      id,
      shop: session.shop,
      idempotencyKey: parsedIdempotency.key,
    });
    await recordAuditEvent({
      shop: session.shop,
      action: "UNDO_REQUESTED",
      entityType: "editHistory",
      entityId: id,
      actor: session.id || session.shop,
    });

    if (command?.enabled) {
      await idempotentCommandService.complete({
        id: command.row.id,
        resourceId: result?.data?.id || id,
      });
    }

    return res.status(200).json({
      id: result?.data?.id || id,
      message: result?.message || "Undo processing started",
    });
    
  } catch (err) {
    console.error(err.message);
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/undo-edit/:id",
    });

    if (command?.enabled) {
      await idempotentCommandService.fail({ id: command.row.id, message: err.message });
    }
    return res.status(500).json(errorResponse("Failed to undo edit"));
  }
};

export const handleBulkEditProduct = async (req, res) => {
  let session;
  let command = null;

  try {
    session = getSessionOrThrow(res);
    command = await idempotentCommandService.begin({
      shop: session.shop,
      operationType: "BULK_EDIT_COMMAND",
      idempotencyKey: req.headers["idempotency-key"],
      resourceType: "EDIT_HISTORY",
    });
    if (command.enabled && !command.created) {
      if (command.row.status === "COMPLETED") {
        return res.status(200).json({
          success: true,
          message: "Bulk edit request already accepted",
          retryClass: classifyRetry("IDEMPOTENT_REPLAY_COMPLETED"),
          id: command.row.resourceId || null,
        });
      }
      return res.status(409).json({
        error: "IDEMPOTENT_DUPLICATE_IN_PROGRESS",
        retryClass: classifyRetry("IDEMPOTENT_DUPLICATE_IN_PROGRESS"),
      });
    }
    const normalizedPayload = normalizeIncomingBulkPayload(req.body || {});
    validateCanonicalPayloadEnvelope(req.body || {});
    req.body = {
      ...(req.body || {}),
      editedField: normalizedPayload.editedField,
      editedType: normalizedPayload.editedBy,
      value: normalizedPayload.value,
      searchKey: normalizedPayload.searchKey,
      replaceText: normalizedPayload.replaceText,
      supportValue: normalizedPayload.supportValue,
      locationId: normalizedPayload.locationId,
    };

    const shop = session.shop;
    const store = await prisma.store.findUnique({
      where: { shopUrl: shop },
      select: { mirrorHealthState: true },
    });

    const source =
      req.body?.source ||
      (req.body?.metadata?.inline ? BulkEditSource.INLINE : BulkEditSource.MANUAL);

    const intent = normalizeLegacyBulkEditPayload({
      shop,
      actorId: req.user?.id || null,
      body: req.body,
      source,
    });

    const validation = validateBulkEditIntent(intent, {
      requireHealthyMirror: true,
      mirrorHealthState: store?.mirrorHealthState,
    });

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        code: "BULK_EDIT_INTENT_INVALID",
        errors: validation.errors,
      });
    }

    logger.info("Bulk edit intent normalized", {
      shop,
      source: intent.source,
      field: intent.operation.field,
      editType: intent.operation.editType,
      targetMode: intent.target.mode,
    });

    const preflight = await preflightExecutionService.runBulkEditPreflight({
      session,
      subscription: req.subscription || {},
      body: req.body || {},
    });
    req.body = {
      ...(req.body || {}),
      intent,
      __preflight: {
        snapshotFingerprint: preflight.snapshotFingerprint,
        mirrorBatchId: preflight.mirrorBatchId,
        targetCount: preflight.targetCount,
        canonicalQueryHash: preflight.canonicalQueryHash || null,
        plannerVersion: preflight.plannerVersion ?? null,
        canonicalOrderBy: preflight.canonicalOrderBy || null,
      },
    };

    const { status } = await getCurrentBulkOperationStatus(session);

    if (status === "RUNNING") {
      const code = "WRITE_OPERATION_RUNNING";
      return res
        .status(409)
        .json(operationConflictResponse(code));
    }

    const lang = req.query.lang || "en";
    const service = new ProductBulkService(session);
    const result = await service.bulkEditProducts({
      body: req.body,
      legacyPayload: req.body,
      intent,
      session,
      subscription: req.subscription,
    });
    await recordAuditEvent({
      shop: session.shop,
      action: "EDIT_QUEUED",
      entityType: "editHistory",
      entityId: result?.id || null,
      actor: session.id || session.shop,
      metadata: {
        source: "bulk_edit",
      },
    });

    if (!result) {
      return res.status(500).json({
        message: "Bulk edit failed - no result returned.",
      });
    }
    if (command?.enabled) {
      await idempotentCommandService.complete({
        id: command.row.id,
        resourceId: result.id || null,
      });
    }

    return res.status(200).json({
      id: result.id,
      title: resolveLocalizedTitle(result.title, lang),
      status:
        translatedEditHistoryStatuses[result.status]?.[lang] || result.status,
      processedCount: result.processedCount,
      totalItems: result.totalItems,
      duration: result.durationMs,
      field: result.field,
      shop: session.shop,
    });
  } catch (err) {
    if (command?.enabled) {
      await idempotentCommandService.fail({ id: command.row.id, message: err.message });
    }
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/bulk-edit",
    });

    if (OPERATION_CONFLICT_CODES.has(err?.code)) {
      return res.status(409).json({
        ...operationConflictResponse(err.code, err.message),
        retryClass: classifyRetry(err.code),
      });
    }

    if (isBulkEditClientError(err)) {
      return res.status(400).json({
        success: false,
        message: err.message || "Invalid bulk edit request",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to queue bulk edit",
    });
  }
};

export const trackEditPreview = async (req, res) => {
  let session;

  try {
    session = getSessionOrThrow(res);

    const normalizedPayload = normalizeIncomingBulkPayload(req.body || {});
    validateCanonicalPayloadEnvelope(req.body || {});
    const {
      filterParams,
      productIds,
      targetSnapshotId,
      page,
      limit,
    } = req.body;
    const field = normalizedPayload.editedField || req.body.field;
    const editType = normalizedPayload.editedBy || req.body.editType;
    const editValue = normalizedPayload.value ?? req.body.editValue;
    const searchKey = normalizedPayload.searchKey ?? req.body.searchKey;
    const replaceText = normalizedPayload.replaceText ?? req.body.replaceText;
    const supportValue = normalizedPayload.supportValue ?? req.body.supportValue;

    const lang = req.query.lang || "en";
    if ("queryWhere" in req.body) {
      return res.status(400).json({
        success: false,
        message: "queryWhere is not allowed from client requests",
      });
    }

    validateBulkEditPayload({
      editedField: field,
      editedBy: editType,
      filterParams,
      targetSnapshotId,
      value: editValue,
      searchKey,
      replaceText,
      supportValue,
    });

    if (process.env.NODE_ENV === "production") {
      void prisma.filterTrack
        .create({
          data: {
            shop: session.shop,
            previewFilterParams: filterParams,
            type: "preview",
            field,
            editOption: editType,
            value: editValue,
            en: lang,
            searchKey,
            replaceText,
            supportValue,
          },
        })
        .catch(async (err) => {
          await logApiError({
            shop: session.shop,
            err,
            req,
            source: "POST /api/edit-preview filterTrack.create",
          });
        });
    }

    const service = new ProductBulkService(session);

    const result = await service.trackEditProducts({
      field,
      editType,
      editValue,
      filterParams,
      productIds,
      targetSnapshotId,
      searchKey,
      replaceText,
      supportValue,
      lang,
      page,
      limit,
      subscription: req.subscription,
    });
    const deterministicInput = req.body?.rawIntent || req.body?.intent || null;
    if (deterministicInput && deterministicInput.targeting?.ast) {
      const intent = createBulkEditIntent({
        ...deterministicInput,
        shop: session.shop,
        source: deterministicInput.source || BulkEditSource.MANUAL,
        field: deterministicInput.field || field,
        editType: deterministicInput.editType || editType,
        value:
          deterministicInput.value ??
          (deterministicInput.operation ? deterministicInput.operation.value : editValue),
        mirrorBatchId:
          deterministicInput.mirrorBatchId ||
          deterministicInput?.scope?.mirrorBatchId ||
          result?.data?.mirrorBatchId ||
          null,
      });
      intent.scope = deterministicInput.scope || {};
      intent.scope.mirrorBatchId = intent.scope.mirrorBatchId || intent.target.mirrorBatchId;
      intent.scope.resource = intent.scope.resource || "PRODUCT";
      intent.targeting = deterministicInput.targeting;
      if (!intent.operation.action && deterministicInput?.operation?.action) {
        intent.operation.action = deterministicInput.operation.action;
      }

      const intentHash = stableHash(intent);
      const snapshot = await freezeTargetSnapshotSet({ intent, intentHash });
      const executionPlan = await buildExecutionPlan({
        intent,
        intentHash,
        snapshotSetId: snapshot.snapshotSetId,
      });

      result.data = {
        ...(result.data || {}),
        intentHash,
        snapshotSetId: snapshot.snapshotSetId,
        executionPlanId: executionPlan.executionPlanId,
        targetCount: snapshot.targetCount,
        planHash: executionPlan.planHash,
      };
    }

    const previewCount = Number(
      result?.data?.count ??
      result?.data?.total ??
      result?.data?.targetCount ??
      result?.data?.previewCount ??
      0,
    );
    result.data = {
      ...(result.data || {}),
      catalogRiskPreview: buildCatalogRiskPreview({
        count: previewCount,
        field,
        filterParams,
      }),
    };
    return res.status(200).json(result);
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/edit-preview",
    });

    if (isBulkEditClientError(err)) {
      return res.status(400).json({
        success: false,
        message: err.message || "Invalid bulk edit preview request",
      });
    }

    return res.status(500).json(errorResponse("Failed to track edit preview"));
  }
};

export const createScheduledEdit = async (req, res) => {
  let session;
  try {
    session = getSessionOrThrow(res);
  } catch {
    return res.status(403).json({ error: "Session expired" });
  }
  const bulkService = session ? new ProductBulkService(session) : null;
  let createdHistoryId = null;
  let scheduledEditQueued = false;

  try {
    const normalizedPayload = normalizeIncomingBulkPayload(req.body || {});
    validateCanonicalPayloadEnvelope(req.body || {});
    const scheduledIntent = normalizeLegacyBulkEditPayload({
      shop: session.shop,
      actorId: req.user?.id || null,
      body: {
        ...(req.body || {}),
        source: BulkEditSource.SCHEDULED,
      },
      source: BulkEditSource.SCHEDULED,
    });
    const scheduledValidation = validateBulkEditIntent(scheduledIntent, {
      requireHealthyMirror: true,
      mirrorHealthState: (await prisma.store.findUnique({
        where: { shopUrl: session.shop },
        select: { mirrorHealthState: true },
      }))?.mirrorHealthState,
    });
    if (!scheduledValidation.valid) {
      return res.status(400).json({
        success: false,
        code: "BULK_EDIT_INTENT_INVALID",
        errors: scheduledValidation.errors,
      });
    }
    const scheduledIntentId = crypto
      .createHash("sha256")
      .update(JSON.stringify(scheduledIntent || {}))
      .digest("hex");
    const scheduledMutationPlanHash = stableHash({
      intentId: scheduledIntentId,
      targetSnapshotId: normalizedTargetSnapshotId || null,
      mirrorBatchId: resolvedTarget?.mirrorBatchId || null,
      plannerFingerprint: resolvedTarget?.plannerFingerprint || null,
      plannerVersion: null,
    });
    if (scheduledIntent.target.mode !== TargetMode.SNAPSHOT || !scheduledIntent.target.targetSnapshotId) {
      return res.status(400).json({
        success: false,
        code: "SCHEDULED_TARGET_SNAPSHOT_REQUIRED",
        message: "One-time scheduled edit requires target snapshot mode.",
      });
    }

    const {
      filterParams,
      scheduledAt: rawScheduledAt,
      targetSnapshotId,
    } = req.body;
    const editedField = normalizedPayload.editedField;
    const editedBy = normalizedPayload.editedBy;
    const value = normalizedPayload.value;
    const searchKey = normalizedPayload.searchKey;
    const replaceText = normalizedPayload.replaceText;
    const supportValue = normalizedPayload.supportValue;
    const locationId = normalizedPayload.locationId;

    const normalizedTargetSnapshotId =
      typeof targetSnapshotId === "string" ? targetSnapshotId.trim() : "";

    if (!normalizedTargetSnapshotId || !editedField) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!FIELD_CONFIGS[editedField]) {
      return res.status(400).json({ error: "Invalid editedField" });
    }

    validateBulkEditPayload({
      editedField,
      editedBy,
      filterParams,
      targetSnapshotId: normalizedTargetSnapshotId,
      value,
      searchKey,
      replaceText,
      supportValue,
      locationId,
      confirm: req.body?.confirm,
    }, { mode: "execute" });

    logger.info("Bulk edit intent normalized", {
      shop: session.shop,
      source: scheduledIntent.source,
      field: scheduledIntent.operation.field,
      editType: scheduledIntent.operation.editType,
      targetMode: scheduledIntent.target.mode,
    });

    const scheduledAt = new Date(rawScheduledAt);
    if (isNaN(scheduledAt.getTime())) {
      return res.status(400).json({ error: "Invalid scheduledAt" });
    }

    const scheduledUndoAt = null;

    const resolvedTarget = normalizedTargetSnapshotId
      ? await getFrozenTargetSnapshotSummary({
          ownerType: "AD_HOC_PRODUCT_TARGET",
          ownerId: normalizedTargetSnapshotId,
          shop: session.shop,
        })
      : await resolveCanonicalProductTarget({
          shop: session.shop,
          filterParams,
          queryParams: {
            page: 1,
            limit: 20,
          },
          sampleLimit: 20,
        });

    const count = resolvedTarget.count;

    const planKey = req.subscription?.planKey;
    if (!planKey) {
      return res.status(403).json({
        error: "Subscription not found",
      });
    }

    const scheduledLimit = getScheduledEditLimit(planKey);
    if (scheduledLimit === null) {
      return res.status(403).json({
        success: false,
        message: `Scheduled edits are not configured for plan ${planKey}. Please update the plan configuration before using this feature.`,
        code: "UNSUPPORTED_PLAN",
      });
    }

    if (scheduledLimit !== Infinity && count > scheduledLimit) {
      return res.status(403).json({
        success: false,
        message: `Your plan allows scheduling edits for only ${scheduledLimit} products at a time. You selected ${count}. Please refine your filters or upgrade to Pro.`,
        code: "PRODUCT_LIMIT_EXCEEDED",
      });
    }

    const updatedTitle = getUpdatedProducts({
      field: editedField,
      editType: editedBy,
      value,
      returnTitleOnly: true,
      supportValue,
      searchKey,
      replaceText,
    });

    const multiLanguageTitle = createMultiLanguageForFileEdit(updatedTitle);

    const undoAllowed = editedField !== "deleteProducts";

    if (scheduledAt.getTime() <= Date.now()) {
      return res.status(400).json({
        error: "Scheduled time must be in the future",
      });
    }

    const { history, frozenCount } = await prisma.$transaction(async (tx) => {
      const operation = await merchantOperationRepository.createPlannedOperationForEdit({
        shop: session.shop,
        type: "SCHEDULED_EDIT",
        title: "Scheduled edit",
        source: "write_through",
        idempotencyKey: `scheduled-edit:${crypto.randomUUID()}`,
        totalItems: Number(count || 0),
        startedAt: null,
      }, tx);

      const created = await tx.editHistory.create({
        data: {
          operationId: operation.id,
          shop: session.shop,
          title: multiLanguageTitle,
          status: "pending",
          executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
          executionIdentity: crypto.randomUUID(),
          processedCount: 0,
          totalItems: count,
          targetSnapshotCount: 0,
          targetMirrorBatchId: resolvedTarget.mirrorBatchId,
          scheduledAt,
          scheduledUndoAt: null,
          type: "Scheduled edit",
          queryFilter: JSON.stringify(
            normalizedTargetSnapshotId ? {} : resolvedTarget.where
          ),
          rules: [
            {
              field: editedField,
              value,
              editOption: editedBy,
              searchKey,
              replaceText,
              supportValue,
              locationId: locationId ?? null,
            },
          ],
          summary: {
            intentId: scheduledIntentId,
            mutationPlanHash: scheduledMutationPlanHash,
            bulkEditIntent: scheduledIntent,
          },
          startedAt: null,
          durationMs: 0,
          batch: {
            frozen: false,
            hasMore: false,
            lastProductId: null,
            size: 75,
            previewCount: count,
            currentBatchTargetCount: 0,
            queuedAt: new Date().toISOString(),
            sourceTargetSnapshotId: normalizedTargetSnapshotId || null,
            intentId: scheduledIntentId,
            mutationPlanHash: scheduledMutationPlanHash,
          },
          undo: buildPlannedUndoState({
            allowed: undoAllowed,
          }),
        },
      });
      await merchantOperationRepository.createForEditHistory(created, tx);

      const frozen = await bulkService.freezeEditHistoryTargets(created.id, tx);

      await bulkEditHistoryRepository.applyProjectionUpdate({
        where: {
          id: created.id,
          shop: session.shop,
        },
        data: {
          totalItems: frozen,
          targetSnapshotCount: frozen,
          batch: {
            frozen: true,
            hasMore: frozen > 0,
            lastProductId: null,
            size: 75,
            previewCount: count,
            currentBatchTargetCount: 0,
            queuedAt: new Date().toISOString(),
            sourceTargetSnapshotId: normalizedTargetSnapshotId || null,
            intentId: scheduledIntentId,
            mutationPlanHash: scheduledMutationPlanHash,
          },
        },
      }, tx);

      return {
        history: created,
        frozenCount: frozen,
      };
    });
    createdHistoryId = history.id;

    const now = Date.now();
    const delay = scheduledAt.getTime() - now;
    if (delay <= 0) {
      await prisma.editHistory
        .deleteMany({
          where: {
            id: history.id,
            shop: session.shop,
          },
        })
        .catch(() => {});
      createdHistoryId = null;

      return res.status(400).json({
        error: "Scheduled time must be in the future",
      });
    }

    let scheduledRun;
    try {
      scheduledRun = await scheduledEditRunRepository.create({
        shop: session.shop,
        scheduledEditId: history.id,
        scheduledFor: scheduledAt,
        status: "PENDING",
        claimedAt: null,
        targetCount: frozenCount,
      });
    } catch (error) {
      if (error?.code === "P2002") {
        return res.status(409).json({
          error: "SCHEDULE_ALREADY_CLAIMED",
          message: "This scheduled edit run has already been claimed.",
        });
      }

      throw error;
    }

    await addScheduledEditJob(
      "scheduled-task",
      { historyId: history.id, shop: session.shop, scheduledRunId: scheduledRun.id },
      { delay, jobId: `scheduled-edit:${session.shop}:${history.id}` }
    );
    scheduledEditQueued = true;

    // Undo scheduling is execution-linked and must be created only after
    // successful execution history exists.

    const updatedHistory = await prisma.editHistory.findFirst({
      where: {
        id: history.id,
        shop: session.shop,
      },
    });

    return res.status(201).json({
      message: "Scheduled successfully",
      scheduledRunStatus: scheduledRun.status,
      history: updatedHistory,
    });
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/scheduled-edit",
    });

    if (createdHistoryId && !scheduledEditQueued) {
      await prisma.editHistory
        .deleteMany({
          where: {
            id: createdHistoryId,
            shop: session.shop,
          },
        })
        .catch(() => {});
    }

    if (isBulkEditClientError(err)) {
      return res.status(400).json({
        message: err.message || "Invalid scheduled edit request",
        error: "Invalid scheduled edit request",
      });
    }

    return res.status(500).json({
      message: err.message || "Failed to create scheduled edit",
      error: "Failed to create scheduled edit",
    });
  }
};

export const cancelScheduledEdit = async (req, res) => {
  let session;
  try {
    session = getSessionOrThrow(res);
  } catch {
    return res.status(403).json({ error: "Session expired" });
  }

  const scheduledEditId = String(req.params.id || "").trim();
  if (!scheduledEditId) {
    return res.status(400).json({ error: "Missing scheduled edit id" });
  }

  try {
    const history = await prisma.editHistory.findFirst({
      where: {
        id: scheduledEditId,
        shop: session.shop,
      },
      select: {
        id: true,
        shop: true,
        type: true,
        status: true,
        executionState: true,
        operationId: true,
      },
    });

    if (!history || history.type !== "Scheduled edit") {
      return res.status(404).json({ error: "Scheduled edit not found" });
    }

    const latestRun = await scheduledEditRunRepository.findLatestByScheduledEditId(
      history.id,
      session.shop,
    );

    if (!latestRun) {
      return res.status(409).json({
        error: "SCHEDULE_NOT_CANCELLABLE",
        message: "Scheduled run was not found.",
      });
    }

    if (latestRun.status !== "PENDING") {
      return res.status(409).json({
        error: "SCHEDULE_NOT_CANCELLABLE",
        message: `Scheduled run is already ${latestRun.status}.`,
      });
    }

    await prisma.$transaction(async (tx) => {
      const cancelled = await scheduledEditRunRepository.cancelPendingByScheduledEditId(
        history.id,
        session.shop,
        tx,
      );

      if (cancelled.count !== 1) {
        const conflict = new Error("SCHEDULE_NOT_CANCELLABLE");
        conflict.code = "SCHEDULE_NOT_CANCELLABLE";
        throw conflict;
      }

      await bulkEditHistoryRepository.applyProjectionUpdate({
        where: {
          id: history.id,
          shop: session.shop,
        },
        data: {
          status: "cancelled",
          executionState: BULK_EDIT_EXECUTION_STATES.CANCELLED,
          completedAt: new Date(),
        },
      }, tx);

      if (history.operationId) {
        const operation = await tx.merchantOperation.findFirst({
          where: {
            id: history.operationId,
            shop: session.shop,
          },
          select: { status: true },
        });
        if (operation?.status && ["PLANNED", "SNAPSHOTTED"].includes(operation.status)) {
          await transitionOperation(
            {
              shop: session.shop,
              operationId: history.operationId,
              from: operation.status,
              to: "CANCELLED",
              data: {
                completedAt: new Date(),
              },
            },
            tx,
          );
        }
      }
    });

    await recordAuditEvent({
      shop: session.shop,
      action: "SCHEDULED_EDIT_CANCELLED",
      entityType: "editHistory",
      entityId: history.id,
      actor: session.id || session.shop,
    });

    return res.status(200).json({
      success: true,
      id: history.id,
      status: "CANCELLED",
    });
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "DELETE /api/products/schedule-task/:id",
    });

    return res.status(err?.code === "SCHEDULE_NOT_CANCELLABLE" ? 409 : 500).json({
      success: false,
      error: err?.code || "SCHEDULE_CANCEL_FAILED",
      message: err?.message || "Failed to cancel scheduled edit",
    });
  }
};
