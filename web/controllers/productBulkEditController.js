import { translatedEditHistoryStatuses } from "../Config/constants.js";
import UndoEditService from "../services/productService/productBulkUndoService.js";
import ProductBulkService from "../services/productService/productBulkEditService.js";
import { errorResponse } from "../utils/responseUtils.js";
import { getCurrentBulkOperationStatus } from "../utils/bulkOperationHelper.js";
import { getUpdatedProducts } from "../helpers/productBulkOperationHelpers/productUpdateHandler.js";
import { FIELD_CONFIGS } from "../helpers/productBulkOperationHelpers/constants.js";
import { createMultiLanguageForFileEdit } from "../utils/googleTranslator.js";
import { addScheduledEditJob } from "../Jobs/Queues/scheduledEditQueue.js";
import { clearAllCachesForShop } from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { prisma } from "../config/database.js";
import { scheduledEditRunRepository } from "../repositories/scheduledEditRunRepository.js";
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
const BULK_EDIT_CLIENT_ERROR_PATTERNS = [
  /required/i,
  /invalid/i,
  /missing/i,
  /not found/i,
  /not allowed/i,
  /cannot/i,
  /plan/i,
  /limit/i,
  /reduce the number of products/i,
  /session expired/i,
];
const OPERATION_CONFLICT_CODES = new Set([
  "WRITE_OPERATION_RUNNING",
  "PRODUCT_SYNC_RUNNING",
  "CATALOG_NOT_READY",
  "INITIAL_SYNC_REQUIRED",
  "MIRROR_SCHEMA_VERSION_MISMATCH",
  "RATE_LIMIT_EXCEEDED",
  "LOCK_HELD",
  "SCHEDULE_ALREADY_CLAIMED",
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
  const message = String(err?.message || "");

  return BULK_EDIT_CLIENT_ERROR_PATTERNS.some((pattern) =>
    pattern.test(message)
  );
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

export const undoEdit = async (req, res) => {
  const session = res.locals.shopify?.session;
  const { id } = req.params;

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const service = new UndoEditService(session);
    const result = await service.undoEdit(id);

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

    return res.status(500).json(errorResponse("Failed to undo edit"));
  }
};

export const handleBulkEditProduct = async (req, res) => {
  const session = res.locals.shopify?.session;

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

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
      subscription: req.subscription,
    });

    if (!result) {
      return res.status(500).json({
        message: "Bulk edit failed â€” no result returned.",
      });
    }

    await clearAllCachesForShop(session.shop);

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
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/bulk-edit",
    });

    if (OPERATION_CONFLICT_CODES.has(err?.code)) {
      return res.status(409).json(operationConflictResponse(err.code, err.message));
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
  const session = res.locals.shopify?.session;

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const {
      field,
      editType,
      editValue,
      searchKey,
      replaceText,
      filterParams,
      queryWhere,
      productIds,
      targetSnapshotId,
      supportValue,
      page,
      limit,
    } = req.body;

    const lang = req.query.lang || "en";
    // console.log("🔴 BACKEND RECEIVED FIELD:", req.body.field);
    // console.log("🔴 EDIT TYPE:", req.body.editType);
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
      queryWhere,
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
    // console.log("🔴 BACKEND RESPONSE:", result);
    return res.status(200).json(result);
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/edit-preview",
    });

    return res.status(500).json(errorResponse("Failed to track edit preview"));
  }
};

export const createScheduledEdit = async (req, res) => {
  const session = res.locals.shopify?.session;
  const bulkService = session ? new ProductBulkService(session) : null;
  let createdHistoryId = null;
  let scheduledEditQueued = false;

  try {
    if (!session) {
      return res.status(403).json({ error: "Session expired" });
    }

    const {
      editedField,
      editedBy,
      filterParams,
      value,
      scheduledAt: rawScheduledAt,
      scheduledUndoAt: rawScheduledUndoAt,
      searchKey,
      replaceText,
      supportValue,
      locationId,
      targetSnapshotId,
    } = req.body;

    const normalizedTargetSnapshotId =
      typeof targetSnapshotId === "string" ? targetSnapshotId.trim() : "";

    if ((!filterParams && !normalizedTargetSnapshotId) || !editedField) {
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
    });

    const scheduledAt = new Date(rawScheduledAt);
    if (isNaN(scheduledAt.getTime())) {
      return res.status(400).json({ error: "Invalid scheduledAt" });
    }

    let scheduledUndoAt = null;
    if (rawScheduledUndoAt) {
      const d = new Date(rawScheduledUndoAt);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ error: "Invalid scheduledUndoAt" });
      }
      scheduledUndoAt = d;
    }

    if (scheduledUndoAt && scheduledUndoAt.getTime() <= scheduledAt.getTime()) {
      return res.status(400).json({
        error: "Undo time must be later than the scheduled edit time",
      });
    }

    if (editedField === "deleteProducts" && scheduledUndoAt) {
      return res.status(400).json({
        error: "Undo is not allowed for product deletion",
      });
    }

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

    const history = await prisma.editHistory.create({
      data: {
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
        scheduledUndoAt,
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
        startedAt: new Date(),
        durationMs: 0,
        batch: {
          frozen: true,
          hasMore: count > 0,
          lastProductId: null,
          size: 75,
          previewCount: count,
          currentBatchTargetCount: 0,
          queuedAt: new Date().toISOString(),
          sourceTargetSnapshotId: normalizedTargetSnapshotId || null,
        },
        undo: buildPlannedUndoState({
          allowed: undoAllowed,
        }),
      },
    });
    createdHistoryId = history.id;

    const frozenCount = await bulkService.freezeEditHistoryTargets(history.id);

    await prisma.editHistory.update({
      where: { id: history.id },
      data: {
        totalItems: frozenCount,
        targetSnapshotCount: frozenCount,
        batch: {
          frozen: true,
          hasMore: frozenCount > 0,
          lastProductId: null,
          size: 75,
          previewCount: count,
          currentBatchTargetCount: 0,
          queuedAt: new Date().toISOString(),
          sourceTargetSnapshotId: normalizedTargetSnapshotId || null,
        },
      },
    });

    const now = Date.now();
    const delay = scheduledAt.getTime() - now;
    if (delay <= 0) {
      await prisma.editHistory
        .delete({
          where: { id: history.id },
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
        status: "CLAIMED",
        claimedAt: new Date(),
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

    if (scheduledUndoAt && scheduledUndoAt.getTime() > now && undoAllowed) {
      const undoDelay = scheduledUndoAt.getTime() - now;
      await addScheduledEditJob(
        "undo-task",
        { historyId: history.id, shop: session.shop },
        {
          delay: undoDelay,
          jobId: `scheduled-undo:${session.shop}:${history.id}`,
        }
      );
    }

    const updatedHistory = await prisma.editHistory.findUnique({
      where: { id: history.id },
    });

    return res.status(201).json({
      message: "Scheduled successfully",
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
        .delete({
          where: { id: createdHistoryId },
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
