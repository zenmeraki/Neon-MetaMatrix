// web/controllers/historyController.js

import { ProductExportService } from "../services/productService/productExportService.js";
import { successResponse, errorResponse } from "../utils/responseUtils.js";
import { EditHistoryService } from "../services/historyService/historyService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { NotFoundError } from "../utils/errorUtils.js";
import { prisma } from "../config/database.js";
import { stableHash } from "../utils/idempotencyKey.js";
import { getBulkEditQueue } from "../jobs/queues/bulkEditJob.js";
import { getBulkUndoQueue } from "../jobs/queues/bulkUndoJob.js";
import { redisClient } from "../config/redis.js";

// ─────────────────────────────────────────────────────────────
// Export histories
// ─────────────────────────────────────────────────────────────

export const getAllExportHistories = asyncHandler(async (req, res) => {
  const session = res.locals.shopify.session;
  const lang = req.query.lang || "en";

  if (!session) {
    return res.status(403).json(errorResponse("Session expired"));
  }

  const service = new ProductExportService(session);

  try {
    const result = await service.getAllExportHistories(lang);

    return res
      .status(200)
      .json(successResponse("Fetched export histories", result));
  } catch (error) {
    console.error("Error in getAllExportHistories:", error);
    await logApiError({
      shop: session.shop,
      err: error,
      req,
      source: "historyController.getAllExportHistories",
    });
    return res.status(500).json(errorResponse("Failed to fetch histories"));
  }
});

export const getExportHistoryDetails = async (req, res) => {
  const session = res.locals.shopify?.session;
  const id = req.params.id;

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const service = new ProductExportService(session);
    const result = await service.getExportHistoryDetails(id);

    return res
      .status(200)
      .json(successResponse("Fetched history detail", result));
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "GET /api/export-history/:id",
    });

    return res
      .status(500)
      .json(errorResponse("Failed to fetch export history details"));
  }
};

// ─────────────────────────────────────────────────────────────
// Edit histories
// ─────────────────────────────────────────────────────────────

export const getAllEditHistories = asyncHandler(async (req, res) => {
  const session = res.locals.shopify.session;
  const { type, search, cursor, limit, lang } = req.query;

  if (!session) {
    return res.status(403).json(errorResponse("Session expired"));
  }

  const service = new EditHistoryService(session, req.activePlan || {});

  try {
    const result = await service.getEditHistories({
      type,
      search,
      cursor: cursor || null,
      limit: limit || 10,
      lang: lang || "en",
    });

    return res.status(200).json(
      successResponse("Fetched edit histories", result.edges, {
        pageInfo: result.pageInfo,
        total: result.totalCount,
        planLimit: result.planLimit,
      }),
    );
  } catch (error) {
    console.error("Error in getAllEditHistories:", error);
    await logApiError({
      shop: session.shop,
      err: error,
      req,
      source: "historyController.getAllEditHistories",
    });
    return res.status(500).json(errorResponse("Failed to fetch histories"));
  }
});

export const getHistoryDetails = async (req, res) => {
  const session = res.locals.shopify?.session;
  const id =
    req.params?.id ||
    req.query?.id ||
    req.query?.historyId ||
    null;
  const { lang } = req.query;

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    if (!id || id === "undefined" || id === "null") {
      return res.status(400).json(errorResponse("History id is required"));
    }

    const service = new EditHistoryService(session, req.activePlan || {});
    const result = await service.getHistoryDetails(id, lang || "en");

    return res
      .status(200)
      .json(successResponse("Fetched history detail", result));
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "GET /api/history/:id",
    });

    if (err instanceof NotFoundError) {
      return res.status(404).json(errorResponse(err.message));
    }

    return res.status(500).json(errorResponse(err.message));
  }
};

export const getHistoryChanges = async (req, res) => {
  const session = res.locals.shopify?.session;
  const id =
    req.params?.id ||
    req.query?.id ||
    req.query?.historyId ||
    null;
  const { page = 1, limit = 10 } = req.query;

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    if (!id || id === "undefined" || id === "null") {
      return res.status(400).json(errorResponse("History id is required"));
    }

    const service = new EditHistoryService(session, req.activePlan || {});
    const result = await service.getHistoryEditChanges(id, page, limit);

    return res
      .status(200)
      .json(successResponse("Fetched history changes", result.changes, {
        currentPage: result.currentPage,
        totalPages: result.totalPages,
        totalCount: result.totalCount,
      }));
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "GET /api/history/:id/changes",
    });

    if (err instanceof NotFoundError) {
      return res.status(404).json(errorResponse(err.message));
    }

    return res.status(500).json(errorResponse(err.message));
  }
};

// ─────────────────────────────────────────────────────────────
// Import histories
// ─────────────────────────────────────────────────────────────

export const getAllImportHistories = asyncHandler(async (req, res) => {
  const session = res.locals.shopify.session;

  if (!session?.shop) {
    return res.status(401).json({
      success: false,
      message: "Shopify session missing",
    });
  }

  let { page = 1, limit = 10 } = req.query;
  page = parseInt(page, 10);
  limit = parseInt(limit, 10);

  const skip = (page - 1) * limit;

  const [histories, totalCount] = await Promise.all([
    prisma.spreadsheetFile.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.spreadsheetFile.count({
      where: { shop: session.shop },
    }),
  ]);

  return res.status(200).json({
    success: true,
    count: histories.length,
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: page,
    data: histories,
  });
});

export const getImportHistoryDetails = asyncHandler(async (req, res) => {
  const session = res.locals.shopify.session;
  const { id } = req.params;

  if (!session?.shop) {
    return res.status(401).json({
      success: false,
      message: "Shopify session missing",
    });
  }

  const history = await prisma.spreadsheetFile.findFirst({
    where: {
      id,
      shop: session.shop,
    },
  });

  if (!history) {
    return res.status(404).json({
      error: "Not Found",
      message: "Import history record not found",
    });
  }

  return res.status(200).json({
    success: true,
    data: history,
  });
});

// ─────────────────────────────────────────────────────────────
// Recurring edits
// ─────────────────────────────────────────────────────────────

export const getRecurringEdits = async (req, res) => {
  try {
    const { shop } = res.locals.shopify.session;
    if (!shop) {
      return res.status(400).json({ message: "Shop is required" });
    }

    if (!prisma.recurringEdit) {
      return res.status(501).json({ message: "Recurring edit is not migrated to Prisma yet" });
    }

    const datas = await prisma.recurringEdit.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        frequency: true,
        dayOfMonthToRun: true,
        daysOfWeekToRun: true,
        isCurrentlyRunning: true,
        createdAt: true,
      },
    });

    return res.status(200).json({
      data: datas,
      message: "recurring edit fetched successfully",
    });
  } catch (err) {
    console.error("getRecurringEdits error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const getRecurringEditById = async (req, res) => {
  try {
    const { shop } = res.locals.shopify.session;
    const { id } = req.params;

    if (!prisma.recurringEdit) {
      return res.status(501).json({ message: "Recurring edit is not migrated to Prisma yet" });
    }

    const job = await prisma.recurringEdit.findFirst({
      where: {
        id,
        shop,
      },
    });

    if (!job) {
      return res.status(404).json({ message: "Recurring edit not found" });
    }

    return res
      .status(200)
      .json({ data: job, message: "Job fetched successfully" });
  } catch (err) {
    console.error("getRecurringEditById error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

const OPERATION_TYPES_BY_LEGACY_HISTORY_TYPE = {
  "Manual edit": ["BULK_EDIT"],
  "Scheduled edit": ["SCHEDULED_EDIT"],
  "Recurring edit": ["BULK_EDIT", "SCHEDULED_EDIT"],
  Favorites: ["BULK_EDIT", "SCHEDULED_EDIT"],
};

const OPERATION_TYPES_BY_LEGACY_EXPORT_TYPE = {
  "Manual export": ["EXPORT"],
  "Scheduled export": ["SCHEDULED_EXPORT"],
};

function mapOperationTypeToLegacyLabel(type) {
  switch (type) {
    case "BULK_EDIT":
      return "Manual edit";
    case "SCHEDULED_EDIT":
      return "Scheduled edit";
    case "BULK_UNDO":
      return "Undo";
    case "EXPORT":
      return "Manual export";
    case "SCHEDULED_EXPORT":
      return "Scheduled export";
    case "IMPORT":
      return "Import";
    default:
      return type || "Operation";
  }
}

function buildExecutionConfidenceTelemetry({
  failedItems = 0,
  retryQueue = 0,
  throttlingDetected = false,
  mirrorConsistency = "UNKNOWN",
  undoSnapshot = "N/A",
  queueLagSeconds = 0,
}) {
  let score = 100;
  const reasons = [];

  if (failedItems > 0) {
    score -= Math.min(20, failedItems * 2);
    reasons.push("Failed writes detected");
  }
  if (retryQueue > 0) {
    score -= Math.min(15, retryQueue);
    reasons.push("Retry queue growing");
  }
  if (throttlingDetected) {
    score -= 10;
    reasons.push("Shopify throttling elevated");
  }
  if (mirrorConsistency !== "SAFE") {
    score -= 8;
    reasons.push("Mirror consistency not fully safe");
  }
  if (undoSnapshot !== "VERIFIED") {
    score -= 6;
    reasons.push("Undo snapshot integrity not verified");
  }
  if (queueLagSeconds > 30) {
    score -= Math.min(10, Math.floor(queueLagSeconds / 30));
    reasons.push("Queue lag elevated");
  }

  return {
    score: Number(Math.max(0, Math.min(100, score)).toFixed(1)),
    reasons,
  };
}

function buildActivityStream({
  phase,
  processedCount,
  totalItems,
  retryQueue,
  failedItems,
  mirrorConsistency,
  undoSnapshot,
}) {
  const stream = [];
  if (["SNAPSHOTTED", "DISPATCHING", "EXECUTING", "FINALIZING", "COMPLETED"].includes(phase)) {
    stream.push({ type: "success", text: "Snapshot frozen" });
  }
  if (["DISPATCHING", "EXECUTING", "FINALIZING", "COMPLETED"].includes(phase)) {
    stream.push({ type: "success", text: "Variant targeting compiled" });
    stream.push({ type: "success", text: "Shopify bulk mutation uploaded" });
  }
  if (retryQueue > 0) {
    stream.push({ type: "info", text: "Retry batch recovered" });
    stream.push({ type: "info", text: `${retryQueue} failed variants requeued` });
  }
  if (failedItems > 0) {
    stream.push({ type: "warning", text: `${failedItems} failed items currently tracked` });
  }
  if (mirrorConsistency === "SAFE" && undoSnapshot === "VERIFIED") {
    stream.push({ type: "success", text: "Consistency verification passed" });
  }
  stream.push({
    type: "info",
    text: `${processedCount} / ${totalItems || processedCount} products processed`,
  });
  return stream.slice(0, 8);
}

function getThrottleBudgetKey(shop) {
  return `shopify:points:${shop}`;
}

async function getRetryQueueCount({ shop, operationId, undoExecutionIdentity }) {
  let count = 0;

  try {
    const bulkEditQueue = getBulkEditQueue();
    const editJobs = await bulkEditQueue.getJobs(
      ["waiting", "delayed", "active", "prioritized"],
      0,
      200,
      true,
    );
    count += editJobs.filter((job) => {
      if (!job?.data || job.data.shop !== shop) return false;
      if (job.data.operationId !== operationId) return false;
      return Number(job.attemptsMade || 0) > 0;
    }).length;
  } catch {
    // best-effort telemetry
  }

  if (!undoExecutionIdentity) {
    return count;
  }

  try {
    const bulkUndoQueue = getBulkUndoQueue();
    const undoJobs = await bulkUndoQueue.getJobs(
      ["waiting", "delayed", "active", "prioritized"],
      0,
      200,
      true,
    );
    count += undoJobs.filter((job) => {
      if (!job?.data || job.data.shop !== shop) return false;
      if (job.data.executionId !== undoExecutionIdentity) return false;
      return Number(job.attemptsMade || 0) > 0;
    }).length;
  } catch {
    // best-effort telemetry
  }

  return count;
}

async function getThrottleTelemetry({ shop, operationId, fallbackStatus }) {
  const fallback = {
    shopifyApiHealth: fallbackStatus === "FAILED" ? "DEGRADED" : "GOOD",
    throttlingDetected: false,
    availableBudget: null,
    throttlingFailureCount: 0,
  };

  const [budgetRaw, throttlingFailureCount] = await Promise.all([
    redisClient.get(getThrottleBudgetKey(shop)).catch(() => null),
    prisma.operationFailure.count({
      where: {
        shop,
        operationId,
        OR: [
          { errorCode: { contains: "429" } },
          { errorCode: { contains: "THROTTL" } },
          { errorMessage: { contains: "throttl", mode: "insensitive" } },
        ],
      },
    }).catch(() => 0),
  ]);

  const availableBudget = Number.parseInt(budgetRaw ?? "", 10);
  const hasBudget = Number.isFinite(availableBudget);
  const budgetSignal = hasBudget ? availableBudget : null;
  const throttlingDetected =
    throttlingFailureCount > 0 || (hasBudget && availableBudget < 100);

  let shopifyApiHealth = "GOOD";
  if (fallbackStatus === "FAILED") {
    shopifyApiHealth = "DEGRADED";
  } else if (fallbackStatus === "CANCELLED") {
    shopifyApiHealth = "STOPPED";
  } else if (throttlingDetected) {
    shopifyApiHealth = "DEGRADED";
  } else if (hasBudget && availableBudget < 250) {
    shopifyApiHealth = "FAIR";
  }

  return {
    shopifyApiHealth,
    throttlingDetected,
    availableBudget: budgetSignal,
    throttlingFailureCount: Number(throttlingFailureCount || 0),
  };
}

function computeUndoEligibility(operation, editHistory) {
  if (!editHistory) {
    return {
      canUndo: false,
      undoBlockedReason: "UNDO_NOT_APPLICABLE",
    };
  }

  const operationType = String(operation?.type || "");
  if (!["BULK_EDIT", "SCHEDULED_EDIT"].includes(operationType)) {
    return {
      canUndo: false,
      undoBlockedReason: "UNDO_NOT_APPLICABLE",
    };
  }

  const operationStatus = String(operation?.status || "").toUpperCase();
  if (operationStatus !== "COMPLETED") {
    return {
      canUndo: false,
      undoBlockedReason: "OPERATION_NOT_COMPLETED",
    };
  }

  const undoAllowed = editHistory?.undo == null ? true : editHistory.undo.allowed === true;
  if (!undoAllowed) {
    return {
      canUndo: false,
      undoBlockedReason: "UNDO_NOT_ALLOWED",
    };
  }

  const undoState = String(
    editHistory?.undo?.status ?? editHistory?.undoStatusSummary?.key ?? "idle",
  ).toLowerCase();

  if (!["idle", "failed", "undo_failed"].includes(undoState)) {
    return {
      canUndo: false,
      undoBlockedReason: "UNDO_ALREADY_RUNNING_OR_DONE",
    };
  }

  return {
    canUndo: true,
    undoBlockedReason: null,
  };
}

function normalizeOperationHistoryItem(operation) {
  const rawType = mapOperationTypeToLegacyLabel(operation.type);
  const exportArtifact = Array.isArray(operation.exports) ? operation.exports[0] : null;
  const editHistory = operation.editHistory || null;
  const exportHistory = operation.exportHistory || null;
  const { canUndo, undoBlockedReason } = computeUndoEligibility(operation, editHistory);
  const targetSnapshotId =
    typeof editHistory?.batch?.sourceTargetSnapshotId === "string"
      ? editHistory.batch.sourceTargetSnapshotId
      : null;
  const mirrorBatchId =
    editHistory?.targetMirrorBatchId ||
    exportArtifact?.metadata?.mirrorBatchId ||
    null;
  const processedCount = Number(operation.processedItems || 0);
  const totalItems = Number(operation.totalItems || 0);
  const percent =
    totalItems > 0
      ? Math.max(0, Math.min(100, Math.round((processedCount / totalItems) * 100)))
      : 0;
  const operationStatus = String(operation.status || "UNKNOWN").toUpperCase();
  const isActive = !["COMPLETED", "FAILED", "CANCELLED"].includes(operationStatus);

  const fallbackHealth = operationStatus === "FAILED" ? "DEGRADED" : "GOOD";
  return {
    id: operation.id,
    operationId: operation.id,
    type: rawType,
    rawType,
    status: String(operation.status || "unknown").toLowerCase(),
    title:
      editHistory?.title ||
      operation.title ||
      exportArtifact?.filename ||
      exportHistory?.filename ||
      rawType,
    filename:
      exportArtifact?.filename ||
      exportHistory?.filename ||
      null,
    fileUrl: exportArtifact?.fileUrl || null,
    totalItems,
    processedCount,
    failedItems: Number(operation.failedItems || 0),
    targetSnapshotCount:
      Number(editHistory?.targetSnapshotCount || operation.totalItems || 0),
    targetMirrorBatchId: editHistory?.targetMirrorBatchId || null,
    mirrorBatchId,
    targetSnapshotId,
    executionState: editHistory?.executionState || null,
    failureStage: editHistory?.failureStage || null,
    undo: editHistory?.undo || null,
    canUndo,
    undoBlockedReason,
    editTime: editHistory?.editTime || null,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    startedAt: operation.startedAt,
    completedAt: operation.completedAt,
    error:
      editHistory?.error ||
      exportHistory?.errorMessage ||
      operation.errorMessage ||
      null,
    source: operation.source || null,
    progressSummary: {
      percent,
      processedCount,
      totalItems,
      isActive,
      status: operationStatus.toLowerCase(),
      label: `${processedCount} / ${totalItems || processedCount}`,
    },
    telemetry: {
      phase: String(editHistory?.executionState || operationStatus).toUpperCase(),
      percent,
      processedProducts: processedCount,
      totalProducts: totalItems,
      variantsUpdated: null,
      etaSeconds: null,
      etaLabel: null,
      throughputPerSecond: null,
      shopifyApiHealth: fallbackHealth,
      retryQueue: 0,
      failedItems: Number(operation.failedItems || 0),
      undoSnapshot:
        editHistory?.undo && editHistory.undo.allowed === true ? "VERIFIED" : "N/A",
      mirrorConsistency: editHistory?.targetMirrorBatchId ? "SAFE" : "UNKNOWN",
      safeToCloseTab: !isActive,
      throttlingDetected: false,
      autoRecoveryActive: false,
      confidence: buildExecutionConfidenceTelemetry({
        failedItems: Number(operation.failedItems || 0),
        retryQueue: 0,
        throttlingDetected: false,
        mirrorConsistency: editHistory?.targetMirrorBatchId ? "SAFE" : "UNKNOWN",
        undoSnapshot:
          editHistory?.undo && editHistory.undo.allowed === true ? "VERIFIED" : "N/A",
        queueLagSeconds: 0,
      }),
      activityStream: buildActivityStream({
        phase: String(editHistory?.executionState || operationStatus).toUpperCase(),
        processedCount,
        totalItems,
        retryQueue: 0,
        failedItems: Number(operation.failedItems || 0),
        mirrorConsistency: editHistory?.targetMirrorBatchId ? "SAFE" : "UNKNOWN",
        undoSnapshot:
          editHistory?.undo && editHistory.undo.allowed === true ? "VERIFIED" : "N/A",
      }),
    },
  };
}

export const getBulkEditLiveProgress = asyncHandler(async (req, res) => {
  const session = res.locals.shopify.session;
  const id = String(req.params?.id || "").trim();

  if (!session) {
    return res.status(403).json(errorResponse("Session expired"));
  }

  if (!id) {
    return res.status(400).json(errorResponse("Operation id is required"));
  }

  const operation = await prisma.merchantOperation.findFirst({
    where: {
      id,
      shop: session.shop,
    },
    select: {
      id: true,
      status: true,
      type: true,
      totalItems: true,
      processedItems: true,
      failedItems: true,
      createdAt: true,
      updatedAt: true,
      startedAt: true,
      completedAt: true,
      editHistory: {
        select: {
          id: true,
          status: true,
          executionState: true,
          processedCount: true,
          totalItems: true,
          targetSnapshotCount: true,
          targetMirrorBatchId: true,
          undo: true,
        },
      },
    },
  });

  if (!operation) {
    return res.status(404).json(errorResponse("Operation not found"));
  }

  const processedCount = Number(
    operation.processedItems ??
      operation.editHistory?.processedCount ??
      0,
  );
  const totalItems = Number(
    operation.totalItems ??
      operation.editHistory?.targetSnapshotCount ??
      operation.editHistory?.totalItems ??
      0,
  );
  const status = String(operation.status || "UNKNOWN").toUpperCase();
  const phaseRaw = String(
    operation.editHistory?.executionState || operation.status || "PENDING",
  )
    .trim()
    .toUpperCase();
  const phase =
    {
      PLANNED: "PLANNED",
      QUEUED: "QUEUED",
      SNAPSHOTTING: "SNAPSHOTTING",
      SNAPSHOTTED: "SNAPSHOTTED",
      DISPATCHING: "DISPATCHING",
      AWAITING_SHOPIFY: "EXECUTING",
      FINALIZING: "FINALIZING",
      VERIFYING: "FINALIZING",
      COMPLETED: "COMPLETED",
      FAILED: "FAILED",
      CANCELLED: "CANCELLED",
      PROCESSING: "EXECUTING",
    }[phaseRaw] || phaseRaw;
  const isActive = !["COMPLETED", "FAILED", "CANCELLED"].includes(status);
  const percentRaw =
    totalItems > 0
      ? Math.max(0, Math.min(100, (processedCount / totalItems) * 100))
      : status === "COMPLETED"
        ? 100
        : 0;
  const percent = Number(percentRaw.toFixed(1));
  const elapsedSeconds = Math.max(
    1,
    Math.floor(
      ((Date.now() - new Date(operation.startedAt || operation.createdAt).getTime()) || 0) / 1000,
    ),
  );
  const throughput = Number((processedCount / elapsedSeconds).toFixed(1));
  const remaining = Math.max(0, totalItems - processedCount);
  const etaSeconds = throughput > 0 ? Math.ceil(remaining / throughput) : null;
  const etaLabel =
    etaSeconds == null
      ? null
      : `${Math.floor(etaSeconds / 60)}m ${String(etaSeconds % 60).padStart(2, "0")}s`;

  const variantChangesCount = operation.editHistory?.id
    ? await prisma.changeRecord.count({
        where: {
          shop: session.shop,
          editHistoryId: operation.editHistory.id,
          OR: [{ entityType: "VARIANT" }, { variantId: { not: null } }],
        },
      })
    : 0;

  const throttleTelemetry = await getThrottleTelemetry({
    shop: session.shop,
    operationId: operation.id,
    fallbackStatus: status,
  });
  const health = throttleTelemetry.shopifyApiHealth;
  const mirrorConsistency = operation.editHistory?.targetMirrorBatchId ? "SAFE" : "UNKNOWN";
  const undoSnapshot =
    operation.editHistory?.undo && operation.editHistory.undo.allowed === true
      ? "VERIFIED"
      : "N/A";
  const retryQueue = await getRetryQueueCount({
    shop: session.shop,
    operationId: operation.id,
    undoExecutionIdentity: operation.editHistory?.undo?.executionIdentity || null,
  });
  const throttlingDetected = throttleTelemetry.throttlingDetected;
  const autoRecoveryActive = retryQueue > 0;
  const safeToCloseTab = !isActive || phase === "FINALIZING" || phase === "COMPLETED";
  const queueLagSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(operation.createdAt).getTime()) / 1000) - elapsedSeconds,
  );
  const confidence = buildExecutionConfidenceTelemetry({
    failedItems: Number(operation.failedItems || 0),
    retryQueue,
    throttlingDetected,
    mirrorConsistency,
    undoSnapshot,
    queueLagSeconds,
  });
  const activityStream = buildActivityStream({
    phase,
    processedCount,
    totalItems,
    retryQueue,
    failedItems: Number(operation.failedItems || 0),
    mirrorConsistency,
    undoSnapshot,
  });

  return res.status(200).json(
    successResponse("Fetched bulk edit live progress", {
      id: operation.id,
      type: operation.type,
      status: status.toLowerCase(),
      processedCount,
      totalItems,
      failedItems: Number(operation.failedItems || 0),
      percent,
      isActive,
      label: `${processedCount} / ${totalItems || processedCount}`,
      telemetry: {
        phase,
        percent,
        processedProducts: processedCount,
        totalProducts: totalItems,
        variantsUpdated: Number(variantChangesCount || 0),
        etaSeconds,
        etaLabel,
        throughputPerSecond: throughput,
        shopifyApiHealth: health,
        retryQueue,
        failedItems: Number(operation.failedItems || 0),
        undoSnapshot,
        mirrorConsistency,
        safeToCloseTab,
        throttlingDetected,
        autoRecoveryActive,
        confidence,
        activityStream,
      },
      startedAt: operation.startedAt,
      completedAt: operation.completedAt,
      updatedAt: operation.updatedAt,
    }),
  );
});

export const getShopOperationHistory = asyncHandler(async (req, res) => {
  const session = res.locals.shopify.session;
  const { type, exportType, search, cursor, limit = 20 } = req.query;

  if (!session) {
    return res.status(403).json(errorResponse("Session expired"));
  }

  const parsedLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const operationTypes = new Set();

  if (type && OPERATION_TYPES_BY_LEGACY_HISTORY_TYPE[type]) {
    OPERATION_TYPES_BY_LEGACY_HISTORY_TYPE[type].forEach((value) =>
      operationTypes.add(value),
    );
  }

  if (exportType && OPERATION_TYPES_BY_LEGACY_EXPORT_TYPE[exportType]) {
    OPERATION_TYPES_BY_LEGACY_EXPORT_TYPE[exportType].forEach((value) =>
      operationTypes.add(value),
    );
  }

  const where = {
    shop: session.shop,
    ...(operationTypes.size > 0
      ? { type: { in: Array.from(operationTypes) } }
      : {}),
  };

  if (search && String(search).trim()) {
    where.OR = [
      { title: { contains: String(search).trim(), mode: "insensitive" } },
      { id: { contains: String(search).trim(), mode: "insensitive" } },
      {
        exportHistory: {
          is: {
            filename: { contains: String(search).trim(), mode: "insensitive" },
          },
        },
      },
    ];
  }

  let cursorFilter = {};
  if (cursor) {
    const cursorRecord = await prisma.merchantOperation.findFirst({
      where: { id: cursor, shop: session.shop },
      select: { id: true, createdAt: true },
    });
    if (cursorRecord) {
      cursorFilter = {
        OR: [
          { createdAt: { lt: cursorRecord.createdAt } },
          {
            AND: [
              { createdAt: cursorRecord.createdAt },
              { id: { lt: cursorRecord.id } },
            ],
          },
        ],
      };
    }
  }

  const queryWhere =
    Object.keys(cursorFilter).length > 0
      ? { AND: [where, cursorFilter] }
      : where;

  const operations = await prisma.merchantOperation.findMany({
    where: queryWhere,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: parsedLimit + 1,
    include: {
      editHistory: {
        select: {
          id: true,
          title: true,
          undo: true,
          status: true,
          executionState: true,
          targetSnapshotCount: true,
          targetMirrorBatchId: true,
          failureStage: true,
          error: true,
          editTime: true,
          batch: true,
        },
      },
      exportHistory: {
        select: {
          filename: true,
          errorMessage: true,
        },
      },
      exports: {
        orderBy: [{ createdAt: "desc" }],
        take: 1,
        select: {
          filename: true,
          fileUrl: true,
          metadata: true,
        },
      },
    },
  });

  const hasNextPage = operations.length > parsedLimit;
  const edges = hasNextPage ? operations.slice(0, -1) : operations;
  const data = edges.map(normalizeOperationHistoryItem);
  const total = await prisma.merchantOperation.count({ where });

  return res.status(200).json(
    successResponse("Fetched operation histories", data, {
      pageInfo: {
        hasNextPage,
        endCursor: edges.length ? edges[edges.length - 1].id : null,
      },
      total,
    }),
  );
});

export const getRecentBulkEditIntentAudit = asyncHandler(async (req, res) => {
  const session = res.locals.shopify.session;

  if (!session?.shop) {
    return res.status(401).json({
      success: false,
      message: "Shopify session missing",
    });
  }

  const limit = Math.max(1, Math.min(100, Number(req.query?.limit) || 20));

  const histories = await prisma.editHistory.findMany({
    where: {
      shop: session.shop,
      type: {
        in: ["Manual edit", "Scheduled edit", "Recurring edit"],
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: limit,
    select: {
      id: true,
      summary: true,
      batch: true,
      updatedAt: true,
    },
  });

  const data = histories.map((history) => {
    const summary = history?.summary && typeof history.summary === "object" ? history.summary : {};
    const batch = history?.batch && typeof history.batch === "object" ? history.batch : {};
    const intentObject =
      summary?.bulkEditIntent && typeof summary.bulkEditIntent === "object"
        ? summary.bulkEditIntent
        : null;
    const persistedIntentId =
      typeof summary?.intentId === "string" && summary.intentId.trim()
        ? summary.intentId.trim()
        : intentObject
        ? stableHash(intentObject)
        : null;
    const mutationPlanHash =
      typeof summary?.mutationPlanHash === "string" && summary.mutationPlanHash.trim()
        ? summary.mutationPlanHash.trim()
        : typeof batch?.mutationPlanHash === "string" && batch.mutationPlanHash.trim()
        ? batch.mutationPlanHash.trim()
        : null;
    const jobIntentId =
      typeof batch?.intentId === "string" && batch.intentId.trim()
        ? batch.intentId.trim()
        : null;

    return {
      historyId: history.id,
      intentId: persistedIntentId,
      mutationPlanHash,
      hasIntent: Boolean(intentObject),
      matchesJobIntentId: Boolean(
        persistedIntentId && jobIntentId && persistedIntentId === jobIntentId,
      ),
    };
  });

  const scopedWhere = { shop: session.shop };
  const executionLinkedWhere = {
    shop: session.shop,
    executionId: { not: null },
  };

  const [
    totalRows,
    executionLinkedRows,
    legacyRows,
    lineageCompliantRows,
    beforeAfterCompliantRows,
    fullyCompliantRows,
  ] = await Promise.all([
    prisma.changeRecord.count({
      where: scopedWhere,
    }),
    prisma.changeRecord.count({
      where: executionLinkedWhere,
    }),
    prisma.changeRecord.count({
      where: {
        shop: session.shop,
        executionId: null,
      },
    }),
    prisma.changeRecord.count({
      where: {
        ...executionLinkedWhere,
        intentHash: { not: null },
        snapshotSetId: { not: null },
        productId: { not: null },
        field: { not: "" },
      },
    }),
    prisma.changeRecord.count({
      where: {
        ...executionLinkedWhere,
        beforeValueJson: { not: null },
        afterValueJson: { not: null },
        beforeFingerprint: { not: null },
        afterFingerprint: { not: null },
        appliedAt: { not: null },
      },
    }),
    prisma.changeRecord.count({
      where: {
        ...executionLinkedWhere,
        intentHash: { not: null },
        snapshotSetId: { not: null },
        productId: { not: null },
        field: { not: "" },
        beforeValueJson: { not: null },
        afterValueJson: { not: null },
        beforeFingerprint: { not: null },
        afterFingerprint: { not: null },
        appliedAt: { not: null },
      },
    }),
  ]);

  const denominator = Math.max(1, Number(executionLinkedRows || 0));
  const ratio = (value) =>
    Number(((Number(value || 0) / denominator) * 100).toFixed(2));

  return res.status(200).json({
    success: true,
    data,
    changeRecordConstraintCompliance: {
      totalRows,
      executionLinkedRows,
      legacyRows,
      lineageCompliantRows,
      beforeAfterCompliantRows,
      fullyCompliantRows,
      lineageCompliancePct: ratio(lineageCompliantRows),
      beforeAfterCompliancePct: ratio(beforeAfterCompliantRows),
      fullCompliancePct: ratio(fullyCompliantRows),
    },
  });
});

function toCsvCell(value) {
  if (value === null || value === undefined) {
    return '""';
  }

  const text =
    typeof value === "string" ? value : JSON.stringify(value);
  const escaped = String(text).replace(/"/g, '""');
  return `"${escaped}"`;
}

export const downloadUndoConflictCsv = asyncHandler(async (req, res) => {
  const session = res.locals.shopify.session;

  if (!session?.shop) {
    return res.status(401).json({
      success: false,
      message: "Shopify session missing",
    });
  }

  const undoRequestId = req.params?.undoRequestId || null;
  if (!undoRequestId || typeof undoRequestId !== "string") {
    return res.status(400).json({
      success: false,
      message: "undoRequestId is required",
    });
  }

  const undoRequest = await prisma.undoRequest.findFirst({
    where: {
      id: undoRequestId,
      shop: session.shop,
    },
    select: {
      id: true,
    },
  });

  if (!undoRequest) {
    return res.status(404).json({
      success: false,
      message: "Undo request not found",
    });
  }

  const rows = await prisma.undoTarget.findMany({
    where: {
      shop: session.shop,
      undoRequestId: undoRequest.id,
      status: {
        in: ["CONFLICT", "FAILED", "SKIPPED"],
      },
    },
    orderBy: [
      { productId: "asc" },
      { variantId: "asc" },
      { field: "asc" },
      { id: "asc" },
    ],
    select: {
      id: true,
      productId: true,
      variantId: true,
      field: true,
      status: true,
      conflictReason: true,
      beforeValueJson: true,
      afterValueJson: true,
      currentValueJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const header = [
    "undoRequestId",
    "undoTargetId",
    "productId",
    "variantId",
    "field",
    "status",
    "conflictReason",
    "beforeValueJson",
    "afterValueJson",
    "currentValueJson",
    "createdAt",
    "updatedAt",
  ];

  const csvLines = [header.map(toCsvCell).join(",")];
  for (const row of rows) {
    csvLines.push(
      [
        undoRequest.id,
        row.id,
        row.productId,
        row.variantId || "",
        row.field || "",
        row.status || "",
        row.conflictReason || "",
        row.beforeValueJson,
        row.afterValueJson,
        row.currentValueJson,
        row.createdAt ? row.createdAt.toISOString() : "",
        row.updatedAt ? row.updatedAt.toISOString() : "",
      ]
        .map(toCsvCell)
        .join(","),
    );
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="undo-conflicts-${undoRequest.id}.csv"`,
  );
  return res.status(200).send(csvLines.join("\n"));
});
