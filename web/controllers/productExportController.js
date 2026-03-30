import { Services } from "../services/productService/productFilterService.js";
import { errorResponse } from "../utils/responseUtils.js";
import { addbulkExportJob } from "../Jobs/Queues/bulkExportJob.js";
import { ProductExportService } from "../services/productService/productExportService.js";
import { clearKeyCaches } from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { prisma } from "../config/database.js";
import {
  freezeTargetSnapshot,
  resolveCanonicalProductTarget,
} from "../services/productService/productTargetingService.js";
import { EXPORT_EXECUTION_STATES } from "../services/exportExecutionStateService.js";

export const handleExportProductsData = async (req, res) => {
  const session = res.locals.shopify?.session;

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const { filterParams, fields, fileName } = req.body;
    const target = await resolveCanonicalProductTarget({
      shop: session.shop,
      filterParams,
      queryParams: { page: 1, limit: 20 },
      sampleLimit: 20,
    });

    const filename = fileName?.endsWith(".csv") ? fileName : `${fileName}.csv`;

    const newExportHistory = await prisma.exportHistory.create({
      data: {
        shop: session.shop,
        filename,
        filters: filterParams,
        status: "pending",
        duration: "Not completed yet.",
      },
    });

    const exportJob = await prisma.exportJob.create({
      data: {
        shop: session.shop,
        filename,
        fields,
        filterQuery: JSON.stringify(target.where),
        status: "PENDING",
        executionState: EXPORT_EXECUTION_STATES.PLANNED,
        targetMirrorBatchId: target.mirrorBatchId,
      },
    });

    const frozenCount = await freezeTargetSnapshot({
      ownerType: "EXPORT_JOB",
      ownerId: exportJob.id,
      shop: session.shop,
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

    const cacheKey = `${session.shop}:sync_details`;
    const exportCacheKey = `${session.shop}:fetchExportHistories`;

    await clearKeyCaches(cacheKey);
    await clearKeyCaches(exportCacheKey);

    await addbulkExportJob({
      exportJobId: exportJob.id,
      shop: session.shop,
      fields,
      source: "manual_export_legacy_endpoint",
      executionId: exportJob.id,
    });

    return res.status(200).json({
      message: "Exporting started â€” queued in background",
      data: newExportHistory,
    });
  } catch (err) {
    console.log(err.message);
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/export-products",
    });

    return res
      .status(500)
      .json(errorResponse("Failed to start export process"));
  }
};

export const createProductExport = async (req, res) => {
  try {
    const { fields, fileName, filterParams } = req.body;
    const session = res.locals.shopify?.session;

    if (!session?.shop) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ message: "No fields selected" });
    }

    if (!fileName?.trim()) {
      return res.status(400).json({ message: "File name required" });
    }

    const shop = session.shop;
    const target = await resolveCanonicalProductTarget({
      shop,
      filterParams,
      queryParams: { page: 1, limit: 20 },
      sampleLimit: 20,
    });

    const filename = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;

    const job = await prisma.exportJob.create({
      data: {
        shop,
        filename,
        fields,
        filterQuery: JSON.stringify(target.where),
        status: "PENDING",
        executionState: EXPORT_EXECUTION_STATES.PLANNED,
        targetMirrorBatchId: target.mirrorBatchId,
      },
    });

    const frozenCount = await freezeTargetSnapshot({
      ownerType: "EXPORT_JOB",
      ownerId: job.id,
      shop,
      where: target.where,
      mirrorBatchId: target.mirrorBatchId,
    });

    await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        targetSnapshotCount: frozenCount,
        executionState: EXPORT_EXECUTION_STATES.QUEUED,
      },
    });

    await clearKeyCaches(`${shop}:fetchExportHistories:`);

    await addbulkExportJob({
      exportJobId: job.id,
      shop,
      fields,
      source: "manual_export",
      executionId: job.id,
    });

    return res.status(200).json({
      exportJobId: job.id,
      status: job.status,
    });
  } catch (error) {
    console.error("Create Export Error:", error);
    return res.status(500).json({
      message: "Failed to create export job",
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
