import { errorResponse } from "../utils/responseUtils.js";
import { addProductExportJob } from "../jobs/queues/exportQueue.js";
import { ProductExportService } from "../services/productService/productExportService.js";
import { clearKeyCaches } from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { prisma } from "../config/database.js";
import {
  cloneFrozenTargetSnapshot,
  getFrozenTargetSnapshotSummary,
} from "../services/productService/productTargetingService.js";
import { preflightExecutionService } from "../services/execution/preflightExecutionService.js";
import { idempotentCommandService } from "../services/idempotentCommandService.js";
import { classifyRetry } from "../utils/errorTaxonomy.js";
import {
  normalizeExportPreset,
  resolveExportFields,
} from "../modules/productExports/exportPresets.js";
import { merchantOperationRepository } from "../repositories/merchantOperationRepository.js";
import { projectOperationToExportJob } from "../services/operationProjectionService.js";
import { exportJobRepository } from "../repositories/exportJobRepository.js";
import { transitionOperation } from "../services/operationTransitionService.js";

function normalizeFilename(fileName) {
  const trimmed = String(fileName || "").trim();

  if (!trimmed) {
    throw new Error("File name required");
  }

  return trimmed.endsWith(".csv") ? trimmed : `${trimmed}.csv`;
}

async function createAndQueueExportJob({
  session,
  subscription = {},
  shop,
  filterParams = [],
  fields = [],
  preset = "custom",
  fileName,
  source,
  targetSnapshotId = null,
  targetSnapshotFingerprint = null,
}) {
  const resolvedFields = resolveExportFields({ fields, preset });
  if (!Array.isArray(resolvedFields) || !resolvedFields.length) {
    throw new Error("No fields selected");
  }

  const normalizedTargetSnapshotId =
    typeof targetSnapshotId === "string" ? targetSnapshotId.trim() : "";
  if (!normalizedTargetSnapshotId) {
    const error = new Error("IMMUTABLE_TARGET_REQUIRED");
    error.code = "IMMUTABLE_TARGET_REQUIRED";
    error.statusCode = 409;
    throw error;
  }

  const preflight = await preflightExecutionService.runExportPreflight({
    session,
    subscription,
    filterParams,
    targetSnapshotId: normalizedTargetSnapshotId,
  });

  const target = await getFrozenTargetSnapshotSummary({
    ownerType: "AD_HOC_PRODUCT_TARGET",
    ownerId: normalizedTargetSnapshotId,
    shop,
  });

  const incomingFingerprint =
    typeof targetSnapshotFingerprint === "string"
      ? targetSnapshotFingerprint.trim()
      : "";
  if (incomingFingerprint && target?.plannerFingerprint && incomingFingerprint !== target.plannerFingerprint) {
    const error = new Error("TARGET_SNAPSHOT_FINGERPRINT_MISMATCH");
    error.statusCode = 409;
    throw error;
  }
  if (
    preflight?.snapshotFingerprint &&
    target?.plannerFingerprint &&
    preflight.snapshotFingerprint !== target.plannerFingerprint
  ) {
    const error = new Error("PREFLIGHT_SNAPSHOT_FINGERPRINT_MISMATCH");
    error.statusCode = 409;
    throw error;
  }

  if (
    preflight?.mirrorBatchId &&
    target?.mirrorBatchId &&
    preflight.mirrorBatchId !== target.mirrorBatchId
  ) {
    const error = new Error("PREFLIGHT_SNAPSHOT_MISMATCH");
    error.statusCode = 409;
    throw error;
  }

  const active = await prisma.exportJob.findFirst({
    where: {
      shop,
      OR: [
        { status: "PROCESSING" },
        {
          executionState: {
            in: [
              EXPORT_EXECUTION_STATES.RUNNING,
              EXPORT_EXECUTION_STATES.FINALIZING,
            ],
          },
        },
      ],
    },
  });

  if (active) {
    throw new Error("Another export is already running for this shop");
  }

  const filename = normalizeFilename(fileName);
  const operation = await merchantOperationRepository.createPlannedOperation(
    {
      shop,
      type: "EXPORT",
      title: filename,
      source,
      idempotencyKey: `export:${shop}:${normalizedTargetSnapshotId}:${Date.now()}`,
      totalItems: Number(target?.count || 0),
    },
  );

  const exportJob = await exportJobRepository.create({
    operationId: operation.id,
    shop,
    filename,
    fileName: filename,
    fields: resolvedFields,
    filterQuery: JSON.stringify({}),
    targetMirrorBatchId: target.mirrorBatchId,
  });

  const frozenCount = (
    await cloneFrozenTargetSnapshot({
      sourceOwnerType: "AD_HOC_PRODUCT_TARGET",
      sourceOwnerId: normalizedTargetSnapshotId,
      targetOwnerType: "EXPORT_JOB",
      targetOwnerId: exportJob.id,
      shop,
    })
  ).count;

  await exportJobRepository.projectionUpdate({
    where: { id: exportJob.id },
    reason: "export_controller_snapshot_projection",
    data: {
      targetSnapshotCount: frozenCount,
      mirrorBatchId: target.mirrorBatchId,
    },
  });
  await transitionOperation({
    shop,
    operationId: operation.id,
    from: "PLANNED",
    to: "SNAPSHOTTED",
    data: {
      totalItems: Number(frozenCount || 0),
      processedItems: 0,
      failedItems: 0,
    },
  });
  await projectOperationToExportJob({
    shop,
    exportJobId: exportJob.id,
    operationId: operation.id,
  });

  try {
    await addProductExportJob(
      {
        exportJobId: exportJob.id,
        shop,
        fields: resolvedFields,
        preset,
        source,
        executionId: exportJob.id,
      },
      {
        jobId: `product-export:${shop}:${exportJob.id}`,
      }
    );
  } catch (error) {
    await exportJobRepository.projectionUpdateMany({
      where: {
        id: exportJob.id,
        shop,
      },
      reason: "export_controller_queue_failure_projection",
      data: {
        error: error.message,
        completedAt: new Date(),
      },
    });
    await transitionOperation({
      shop,
      operationId: operation.id,
      from: "SNAPSHOTTED",
      to: "FAILED",
      data: {
        failedAt: new Date(),
        errorMessage: error.message,
      },
    });
    await projectOperationToExportJob({
      shop,
      exportJobId: exportJob.id,
      operationId: operation.id,
    });

    throw error;
  }

  await clearKeyCaches(`${shop}:fetchExportHistories:`);

  return exportJob;
}

export const handleExportProductsData = async (req, res) => {
  const session = res.locals.shopify?.session;

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const exportJob = await createAndQueueExportJob({
      session,
      subscription: req.subscription || {},
      shop: session.shop,
      filterParams: req.body?.filterParams,
      fields: req.body?.fields,
      preset: normalizeExportPreset(req.body?.preset),
      fileName: req.body?.fileName,
      targetSnapshotId: req.body?.targetSnapshotId,
      targetSnapshotFingerprint: req.body?.targetSnapshotFingerprint,
      source: "manual_export_legacy_endpoint",
    });

    return res.status(200).json({
      message: "Export queued successfully",
      data: exportJob,
    });
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/export-products",
    });

    const statusCode = Number(err?.statusCode) || 500;
    return res.status(statusCode).json(
      errorResponse(err.message || "Failed to start export process"),
    );
  }
};

export const createProductExport = async (req, res) => {
  let command = null;
  try {
    const session = res.locals.shopify?.session;

    if (!session?.shop) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    command = await idempotentCommandService.begin({
      shop: session.shop,
      operationType: "EXPORT_COMMAND",
      idempotencyKey: req.headers["idempotency-key"],
      resourceType: "EXPORT_JOB",
    });
    if (command.enabled && !command.created) {
      if (command.row.status === "COMPLETED") {
        return res.status(200).json({
          exportJobId: command.row.resourceId,
          status: "PENDING",
          retryClass: classifyRetry("IDEMPOTENT_REPLAY_COMPLETED"),
        });
      }
      return res.status(409).json({
        error: "IDEMPOTENT_DUPLICATE_IN_PROGRESS",
        retryClass: classifyRetry("IDEMPOTENT_DUPLICATE_IN_PROGRESS"),
      });
    }

    const job = await createAndQueueExportJob({
      session,
      subscription: req.subscription || {},
      shop: session.shop,
      filterParams: req.body?.filterParams,
      fields: req.body?.fields,
      preset: normalizeExportPreset(req.body?.preset),
      fileName: req.body?.fileName,
      targetSnapshotId: req.body?.targetSnapshotId,
      targetSnapshotFingerprint: req.body?.targetSnapshotFingerprint,
      source: "manual_export",
    });

    if (command?.enabled) {
      await idempotentCommandService.complete({
        id: command.row.id,
        resourceId: job.id,
      });
    }

    return res.status(200).json({
      exportJobId: job.id,
      status: job.status,
    });
  } catch (error) {
    if (command?.enabled) {
      await idempotentCommandService.fail({ id: command.row.id, message: error.message });
    }
    const statusCode = Number(error?.statusCode) || 500;
    return res.status(statusCode).json({
      message: error.message || "Failed to create export job",
    });
  }
};

export const handleDownloadExportProductsData = async (req, res) => {
  const session = res.locals.shopify?.session;

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const service = new ProductExportService(session);
    const result = await service.getExportHistoryDetails(req.params.id);

    if (!result) {
      return res.status(404).json({
        message: "Export history not found",
      });
    }

    res.header("Content-Type", "text/csv");
    res.attachment(result.filename);
    return res.send(result.exportedData);
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "GET /api/export-products/:id/download",
    });

    return res
      .status(500)
      .json(errorResponse("Failed to download export file"));
  }
};
