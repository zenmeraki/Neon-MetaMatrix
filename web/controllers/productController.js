// web/controllers/productController.js
import { Services } from "../services/productService/productFilterService.js";
import { successResponse, errorResponse } from "../utils/responseUtils.js";
import { translatedEditHistoryStatuses } from "../Config/constants.js";
import UndoEditService from "../services/productService/productBulkUndoService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getCurrentBulkOperationStatus } from "../utils/bulkOperationHelper.js";
import { addbulkExportJob } from "../Jobs/Queues/bulkExportJob.js";
import { ProductExportService } from "../services/productService/productExportService.js";

import shopify from "../shopify.js";
import fs from "fs";
import ProductBulkService from "../services/productService/productBulkEditService.js";
import { getUpdatedProducts } from "../helpers/productBulkOperationHelpers/productUpdateHandler.js";
import {
  createMultiLanguage,
  createMultiLanguageForFileEdit,
} from "../utils/googleTranslator.js";
import { scheduledEditQueue } from "../Jobs/Queues/scheduledEditQueue.js";
import {
  clearKeyCaches,
  clearAllCachesForShop,
  getCache,
  setCache,
} from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { uploadCsvToCloudinary } from "../utils/uploadCsvToCloudinary.js";

import { prisma } from "../config/database.js";


const productService = new Services();

/**
 * GET /api/products
 * Product listing with filters (still backed by your Mongo/PG filter engine in Services)
 * Only tracking (FilterTrack) is converted to Prisma here.
 */
export const getProductsWithQuery = async (req, res) => {
  const session = res.locals.shopify?.session;

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const result = await productService.getProductsWithFilters({
      queryParams: req.query,
      filterParams: req.body.filterParams,
      shop: session.shop,
    });

    if (process.env.NODE_ENV === "production") {
      await prisma.filterTrack.create({
        data: {
          shop: session.shop,
          filterParams: req.body?.filterParams || {},
          respondProductCount: result?.count || 0,
          type: "filter",
        },
      });
    }

    return res
      .status(200)
      .json(successResponse("Products fetched successfully", result));
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "GET /api/products",
    });

    return res.status(500).json(errorResponse("Failed to fetch products"));
  }
};

export const undoEdit = async (req, res) => {
  const session = res.locals.shopify?.session;
  const { id } = req.params;

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const { status } = await getCurrentBulkOperationStatus(session);

    if (status === "RUNNING") {
      return res
        .status(400)
        .json({ message: "Another operation is running in background" });
    }

    const service = new UndoEditService(session);
    const result = await service.undoEdit(id);

    return res.status(200).json(result.data);
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
      return res
        .status(400)
        .json({ message: "Another operation is running in background" });
    }

    const lang = req.query.lang || "en";
    const service = new ProductBulkService(session);
    const result = await service.bulkEditProducts({
      ...req,
      subscription: req.subscription,
    });

    if (!result) {
      return res.status(500).json({
        message: "Bulk edit failed — no result returned.",
      });
    }

    await clearAllCachesForShop(session.shop);

    return res.status(200).json({
      id: result.id, // NOTE: this is coming from your bulk service, still using Mongo for history
      title: result.title,
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

    return res.status(400).json({
      success: false,
      message:
        err.message || "An unexpected error occurred. Please try again later.",
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
      supportValue,
      page,
      limit,
    } = req.body;

    const lang = req.query.lang || "en";

    if (process.env.NODE_ENV === "production") {
      await prisma.filterTrack.create({
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
      });
    }

    const service = new ProductBulkService(session);

    const result = await service.trackEditProducts({
      field,
      editType,
      editValue,
      filterParams,
      searchKey,
      replaceText,
      supportValue,
      lang,
      page,
      limit,
      subscription: req.subscription,
    });

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

export const checkEditStatus = asyncHandler(async (req, res) => {
  const id = req.params.id;

  const history = await prisma.editHistory.findUnique({
    where: { id },
    select: {
      processedCount: true,
      totalItems: true,
      durationMs: true,
    },
  });

  if (history) {
    return res.status(200).json({
      rootObjectCount: history.processedCount,
      totalItems: history.totalItems,
      duration: history.durationMs,
    });
  }

  return res.status(200).json({
    status: "not_found",
    message: "No history found",
  });
});

export const handleExportProductsData = async (req, res) => {
  const session = res.locals.shopify?.session;

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const { filterParams, fields, fileName } = req.body;

    const newExportHistory = await prisma.exportHistory.create({
      data: {
        shop: session.shop,
        filename: fileName,
        filters: filterParams, // JSON column
        status: "pending",
        duration: "Not completed yet.",
      },
    });

    // Clear cached sync details
    const cacheKey = `${session.shop}:sync_details`;
    const exportCacheKey = `${session.shop}:fetchExportHistories`;

    await clearKeyCaches(cacheKey);
    await clearKeyCaches(exportCacheKey);

    await addbulkExportJob({
      filterParams,
      session,
      columns: fields,
      filename: fileName,
      historyId: newExportHistory.id, // Prisma id
    });

    return res.status(200).json({
      message: "Exporting started — queued in background",
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
    const productService = new Services();

   const where = productService.getProductPrismaWhere(filterParams, shop);

    const filename = fileName.endsWith(".csv")
      ? fileName
      : `${fileName}.csv`;

const job = await prisma.exportJob.create({
  data: {
    shop,
    filename,
    fields,
    filterQuery: JSON.stringify(where),
    status: "PENDING",
  },
});

    await clearKeyCaches(`${shop}:fetchExportHistories:`);

    await addbulkExportJob({
      exportJobId: job.id,
      shop,
      fields,
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

export const getProductTypes = async (req, res) => {
  try {
    const { search = "" } = req.query;
    const session = res.locals.shopify?.session;

    if (!session?.shop) {
      return res.status(401).json({ message: "Shopify session missing" });
    }

    const shop = session.shop;

    const cacheKey = `${shop}:productTypes:${search.toLowerCase()}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.status(200).json({
        data: cached,
        message: "Product types fetched from cache",
      });
    }

    // Prisma equivalent of aggregate-distinct productType
    const result = await prisma.product.findMany({
      where: {
        shop,
        NOT: [
          { productType: null },
          { productType: "" },
        ],
        ...(search
          ? {
              productType: {
                contains: search,
                mode: "insensitive",
              },
            }
          : {}),
      },
      select: {
        productType: true,
      },
      distinct: ["productType"],
      orderBy: {
        productType: "asc",
      },
      take: 20,
    });

    const productTypes = result.map((r) => ({ title: r.productType }));

    await setCache(cacheKey, productTypes, 300);

    return res.status(200).json({
      data: productTypes,
      message: "Product types fetched from product mirror",
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      message: "Failed to fetch product types",
    });
  }
};

export const clearProductTypes = asyncHandler(async (req, res) => {
  const session = res.locals?.shopify?.session;
  if (!session?.shop) {
    return res.status(401).json({ error: "Shopify session missing" });
  }

  const { status } = await getCurrentBulkOperationStatus(session, "QUERY");
  if (status === "RUNNING") {
    return res
      .status(400)
      .json({ message: "Another operation is running in background" });
  }

  const client = new shopify.api.clients.Graphql({ session });

  const BULK_OPERATION_MUTATION = `mutation {
    bulkOperationRunQuery(
      query: """
        {
          products {
            edges {
              node {
                id
                productType
              }
            }
          }
        }
      """
    ) {
      bulkOperation {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }`;

  const bulkResponse = await client.query({
    data: {
      query: BULK_OPERATION_MUTATION,
    },
  });

  if (bulkResponse.body.errors) {
    throw new Error(bulkResponse.body.errors[0].message);
  }

  const bulkOperationId =
    bulkResponse.body.data.bulkOperationRunQuery.bulkOperation.id;

  // Update store syncing status in Prisma
  const result = await prisma.store.update({
    where: { shopUrl: session.shop },
    data: {
      isProductTypeSyncing: true,
      lastProductTypeSyncAt: new Date(),
    },
  });

  if (!result) {
    throw new Error("Store not found");
  }

  // Create sync history
  await prisma.syncHistory.create({
    data: {
      shop: session.shop,
      bulkOperationId,
      status: "processing",
      duration: 0,
      recordCount: 0,
      operationType: "ProductType",
    },
  });

  // Clear cached sync details
  const cacheKey = `${session.shop}:sync_details`;
  await clearKeyCaches(cacheKey);

  return res.status(200).send({
    message: "productType syncing started",
    operationId: bulkOperationId,
  });
});

export const csvBulkProductsEdit = asyncHandler(async (req, res) => {
  const session = res.locals.shopify.session;

  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "CSV file is required",
    });
  }

  const columnMappings = req.body.columnMappings
    ? JSON.parse(req.body.columnMappings)
    : {};

  if (!Object.values(columnMappings).includes("id")) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({
      success: false,
      message: "Product ID mapping is required",
    });
  }

  const { status } = await getCurrentBulkOperationStatus(session);
  if (status === "RUNNING") {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({
      success: false,
      message: "Another bulk operation is already running",
    });
  }

  // NOTE:
  // Your original SpreedSheetEdit Mongo model had filename + status.
  // Prisma SpreadsheetFile doesn't, so this is a minimal approximation.
  const importHistory = await prisma.spreadsheetFile.create({
    data: {
      shop: session.shop,
      fileUrl: null,
      columnMappings: columnMappings,
      totalRows: 0,
    },
  });

  await addbulkImportEditJob({
    session,
    filePath: req.file.path,
    importHistoryId: importHistory.id,
  });

  await clearAllCachesForShop(session.shop);

  res.status(200).json({
    success: true,
    message: "CSV import queued successfully",
    data: importHistory,
  });
});

export const importCsvController = async (req, res) => {
  try {
    const { columnMappings } = req.body;
    const session = res.locals.shopify.session;
    const shop = session.shop;

    if (!req.file) {
      return res.status(400).json({ message: "CSV file required" });
    }

    if (!columnMappings) {
      return res.status(400).json({ message: "columnMappings missing" });
    }
    const parsedMappings = JSON.parse(columnMappings);

    // 2️⃣ Upload to Cloudinary
    const fileUrl = await uploadCsvToCloudinary(req.file.path, "124673");

    // 1️⃣ Create DB record
    const importDoc = await prisma.spreadsheetFile.create({
      data: {
        shop,
        columnMappings: parsedMappings,
        fileUrl,
        totalRows: null,
      },
    });

    const multiTitle = createMultiLanguageForFileEdit(
      req.file.originalname,
    );

    const newHistory = await prisma.editHistory.create({
      data: {
        shop,
        title: multiTitle,
        editedType: "mixed",
        startedAt: new Date(),
        importFileId: importDoc.id,
        batch: {
          lastProductId: null,
          hasMore: false,
          size: 0,
        },
      },
    });

    await clearKeyCaches(`${shop}:fetchHistories`);

    // 3️⃣ Queue job
    await addbulkImportEditJob({
      historyId: newHistory.id,
      fileUrl,
      columnMappings: parsedMappings,
      session,
    });

    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      importId: newHistory.id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

export const createScheduledEdit = async (req, res) => {
  const session = res.locals.shopify?.session;

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
    } = req.body;

    if (!filterParams || !editedField) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // 🔹 Validate scheduledAt
    const scheduledAt = new Date(rawScheduledAt);
    if (isNaN(scheduledAt.getTime())) {
      return res.status(400).json({ error: "Invalid scheduledAt" });
    }

    // 🔹 Validate scheduledUndoAt (optional)
    let scheduledUndoAt = null;
    if (rawScheduledUndoAt) {
      const d = new Date(rawScheduledUndoAt);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ error: "Invalid scheduledUndoAt" });
      }
      scheduledUndoAt = d;
    }

    if (editedField === "deleteProducts" && scheduledUndoAt) {
      return res.status(400).json({
        error: "Undo is not allowed for product deletion",
      });
    }

    // 🔹 Build Prisma where for Product
    const where = productService.getProductPrismaWhere(
      filterParams,
      session.shop,
    );

    const count = await prisma.product.count({ where });

    const planKey = req.subscription?.planKey;
    if (!planKey) {
      return res.status(403).json({
        error: "Subscription not found",
      });
    }

    let scheduledLimit = 0;
    if (planKey === "ADVANCED_MONTHLY") {
      scheduledLimit = 1000;
    } else if (planKey === "PRO_MONTHLY") {
      scheduledLimit = Infinity;
    }

    if (scheduledLimit !== Infinity && count > scheduledLimit) {
      return res.status(403).json({
        success: false,
        message: `Your plan allows scheduling edits for only ${scheduledLimit} products at a time. You selected ${count}. Please refine your filters or upgrade to Pro.`,
        code: "PRODUCT_LIMIT_EXCEEDED",
      });
    }

    // 🔹 Generate preview title
    const updatedTitle = getUpdatedProducts({
      field: editedField,
      editType: editedBy,
      value,
      returnTitleOnly: true,
      supportValue,
      searchKey,
      replaceText,
    });

    const multiLanguageTitle = await createMultiLanguage(updatedTitle);

    const undoAllowed = editedField !== "deleteProducts";

    const delay = scheduledAt.getTime() - Date.now();
    if (delay <= 0) {
      return res.status(400).json({
        error: "Scheduled time must be in the future",
      });
    }

    // 🔹 Create history record (Prisma)
    const history = await prisma.editHistory.create({
      data: {
        shop: session.shop,
        title: multiLanguageTitle,
        status: "pending",
        processedCount: 0,
        totalItems: count,
        scheduledAt,
        scheduledUndoAt,
        type: "Scheduled edit",
        queryFilter: JSON.stringify(where),
        rules: [
          {
            field: editedField,
            value,
            editOption: editedBy,
            searchKey,
            replaceText,
            supportValue,
          },
        ],
        startedAt: new Date(),
        undo: {
          allowed: undoAllowed,
        },
      },
    });

    await scheduledEditQueue.add(
      "scheduled-task",
      { historyId: history.id },
      { delay, jobId: `task-${history.id}` },
    );

    // 🔹 Schedule undo job (optional)
    if (scheduledUndoAt && scheduledUndoAt.getTime() > Date.now() && undoAllowed) {
      const undoDelay = scheduledUndoAt.getTime() - Date.now();
      if (undoDelay > 0) {
        await scheduledEditQueue.add(
          "undo-task",
          { historyId: history.id },
          { delay: undoDelay, jobId: `undo-${history.id}` },
        );
      }
    }

    return res.status(201).json({
      message: "Scheduled successfully",
      history,
    });
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/scheduled-edit",
    });

    return res.status(500).json({
      error: "Failed to create scheduled edit",
    });
  }
};