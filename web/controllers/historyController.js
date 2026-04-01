// web/controllers/historyController.js

import { ProductExportService } from "../services/productService/productExportService.js";
import { successResponse, errorResponse } from "../utils/responseUtils.js";
import { EditHistoryService } from "../services/historyService/historyService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { NotFoundError } from "../utils/errorUtils.js";
import { prisma } from "../config/database.js";

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
      return res.status(404).json(errorResponse("History not found"));
    }

    return res.status(500).json(errorResponse("Failed to fetch history details"));
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
      return res.status(404).json(errorResponse("History not found"));
    }

    return res.status(500).json(errorResponse("Failed to fetch history changes"));
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
    await logApiError({
      shop: res.locals.shopify?.session?.shop,
      err,
      req,
      source: "historyController.getRecurringEdits",
    });
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
    await logApiError({
      shop: res.locals.shopify?.session?.shop,
      err,
      req,
      source: "historyController.getRecurringEditById",
    });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};
