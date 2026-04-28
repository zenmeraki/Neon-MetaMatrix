import { errorResponse } from "../utils/responseUtils.js";
import { addProductExportJob } from "../Jobs/Queues/exportQueue.js";
import { ProductExportService } from "../services/productService/productExportService.js";
import { clearKeyCaches } from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { prisma } from "../config/database.js";
import {
  cloneFrozenTargetSnapshot,
  freezeTargetSnapshot,
  getFrozenTargetSnapshotSummary,
  resolveCanonicalProductTarget,
} from "../services/productService/productTargetingService.js";
import { EXPORT_EXECUTION_STATES } from "../services/exportExecutionStateService.js";

function normalizeFilename(fileName) {
  const trimmed = String(fileName || "").trim();

  if (!trimmed) {
    throw new Error("File name required");
  }

  return trimmed.endsWith(".csv") ? trimmed : `${trimmed}.csv`;
}

async function createAndQueueExportJob({
  shop,
  filterParams = [],
  fields = [],
  fileName,
  source,
  targetSnapshotId = null,
}) {
  if (!Array.isArray(fields) || !fields.length) {
    throw new Error("No fields selected");
  }

  const normalizedTargetSnapshotId =
    typeof targetSnapshotId === "string" ? targetSnapshotId.trim() : "";
  const usesFrozenTarget = Boolean(normalizedTargetSnapshotId);
  const target = normalizedTargetSnapshotId
    ? await getFrozenTargetSnapshotSummary({
        ownerType: "AD_HOC_PRODUCT_TARGET",
        ownerId: normalizedTargetSnapshotId,
        shop,
      })
    : await resolveCanonicalProductTarget({
        shop,
        filterParams,
        queryParams: { page: 1, limit: 20 },
        sampleLimit: 20,
      });

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
  const exportJob = await prisma.exportJob.create({
    data: {
      shop,
      filename,
      fileName: filename,
      fields,
      filterQuery: JSON.stringify(usesFrozenTarget ? {} : target.where || {}),
      status: "PENDING",
      executionState: EXPORT_EXECUTION_STATES.PLANNED,
      targetMirrorBatchId: target.mirrorBatchId,
    },
  });

  const frozenCount = normalizedTargetSnapshotId
    ? (
        await cloneFrozenTargetSnapshot({
          sourceOwnerType: "AD_HOC_PRODUCT_TARGET",
          sourceOwnerId: normalizedTargetSnapshotId,
          targetOwnerType: "EXPORT_JOB",
          targetOwnerId: exportJob.id,
          shop,
        })
      ).count
    : await freezeTargetSnapshot({
        ownerType: "EXPORT_JOB",
        ownerId: exportJob.id,
        shop,
        where: target.where,
        mirrorBatchId: target.mirrorBatchId,
      });

  await prisma.exportJob.update({
    where: { id: exportJob.id },
    data: {
      targetSnapshotCount: frozenCount,
      executionState: EXPORT_EXECUTION_STATES.QUEUED,
    },
  });

  try {
    await addProductExportJob(
      {
        exportJobId: exportJob.id,
        shop,
        fields,
        source,
        executionId: exportJob.id,
      },
      {
        jobId: `product-export:${shop}:${exportJob.id}`,
      }
    );
  } catch (error) {
    await prisma.exportJob.updateMany({
      where: {
        id: exportJob.id,
        shop,
        status: "PENDING",
      },
      data: {
        status: "FAILED",
        executionState: EXPORT_EXECUTION_STATES.FAILED,
        error: error.message,
        completedAt: new Date(),
      },
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
      shop: session.shop,
      filterParams: req.body?.filterParams,
      fields: req.body?.fields,
      fileName: req.body?.fileName,
      targetSnapshotId: req.body?.targetSnapshotId,
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

    return res
      .status(500)
      .json(errorResponse(err.message || "Failed to start export process"));
  }
};

export const createProductExport = async (req, res) => {
  try {
    const session = res.locals.shopify?.session;

    if (!session?.shop) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const job = await createAndQueueExportJob({
      shop: session.shop,
      filterParams: req.body?.filterParams,
      fields: req.body?.fields,
      fileName: req.body?.fileName,
      targetSnapshotId: req.body?.targetSnapshotId,
      source: "manual_export",
    });

    return res.status(200).json({
      exportJobId: job.id,
      status: job.status,
    });
  } catch (error) {
    return res.status(500).json({
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
