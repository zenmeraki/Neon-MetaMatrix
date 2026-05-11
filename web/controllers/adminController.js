// web/controllers/adminController.js (or similar)

// ❌ Remove this Mongo import:
// import History from "../schema/editHistorySchema.js";

import adminService from "../services/adminService.js";

// ✅ Add Prisma
import  {prisma} from "../config/database.js"

// Dashboard Overview
export const getDashboard = async (req, res) => {
  try {
    const overview = await adminService.getDashboardOverview();
    res.json({ success: true, data: overview });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard data",
      error: error.message,
    });
  }
};

export const getCompletedEditHistorySummary = async (req, res) => {
  try {
    // 1️⃣ groupBy shop where status = "completed"
    const groups = await prisma.editHistory.groupBy({
      by: ["shop"],
      where: {
        status: "completed",
      },
      _count: {
        _all: true,
      },
      _max: {
        completedAt: true,
      },
    });

    // 2️⃣ Fetch Store rows for these shops
    const shops = groups.map((g) => g.shop).filter(Boolean);
    const stores = shops.length
      ? await prisma.store.findMany({
          where: { shopUrl: { in: shops } },
          select: {
            shopUrl: true,
            isUnInstalled: true,
          },
        })
      : [];

    const storeMap = new Map(
      stores.map((s) => [s.shopUrl, s.isUnInstalled]),
    );

    // 3️⃣ Build summary objects (shop, completedEdits, isUnInstalled, lastEditAt)
    const rawSummaries = groups.map((g) => {
      const shop = g.shop;
      const completedEdits = g._count._all;
      const lastEditAt = g._max.completedAt ?? null;
      const isUnInstalled = storeMap.get(shop) ?? null;

      return {
        shop,
        completedEdits,
        isUnInstalled,
        lastEditAt,
      };
    });

    // 4️⃣ Sort latest first by lastEditAt
    rawSummaries.sort((a, b) => {
      const aTime = a.lastEditAt ? a.lastEditAt.getTime() : 0;
      const bTime = b.lastEditAt ? b.lastEditAt.getTime() : 0;
      return bTime - aTime;
    });

    // 5️⃣ Format lastEditAt into "DD Mon YYYY, hh:mm AM/PM" in Asia/Kolkata
    const formattedData = rawSummaries.map((item) => ({
      ...item,
      lastEditAt: item.lastEditAt
        ? new Date(item.lastEditAt).toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata",
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          })
        : null,
    }));

    res.status(200).json({
      success: true,
      count: formattedData.length,
      data: formattedData,
    });
  } catch (error) {
    console.error("EditHistory Aggregate Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch completed edit history summary",
    });
  }
};

// Store Management
export const getStoreStats = async (req, res) => {
  try {
    const stats = await adminService.getStoreStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch store stats",
      error: error.message,
    });
  }
};

export const getAllStores = async (req, res) => {
  try {
    const { page, limit, status, search } = req.query;
    const result = await adminService.getAllStores({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      status: status || "all",
      search: search || "",
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch stores",
      error: error.message,
    });
  }
};

export const getStoreDetails = async (req, res) => {
  try {
    const { shopUrl } = req.params;
    const details = await adminService.getStoreDetails(shopUrl);
    res.json({ success: true, data: details });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message || "Store not found",
    });
  }
};

// Edit History Management
export const getEditHistoryStats = async (req, res) => {
  try {
    const { shopUrl } = req.query;
    const stats = await adminService.getEditHistoryStats(shopUrl);
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch edit history stats",
      error: error.message,
    });
  }
};

export const getEditHistoryList = async (req, res) => {
  try {
    const { page, limit, status, type, shopUrl, sortBy, sortOrder } = req.query;
    const result = await adminService.getEditHistoryList({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      status: status || "all",
      type: type || "all",
      shopUrl: shopUrl || null,
      sortBy: sortBy || "editTime",
      sortOrder: sortOrder || "desc",
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch edit history",
      error: error.message,
    });
  }
};

export const getFailedEdits = async (req, res) => {
  try {
    const { page, limit, shopUrl } = req.query;
    const result = await adminService.getFailedEdits({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      shopUrl: shopUrl || null,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch failed edits",
      error: error.message,
    });
  }
};

// Sync History Management
export const getSyncHistoryStats = async (req, res) => {
  try {
    const { shopUrl } = req.query;
    const stats = await adminService.getSyncHistoryStats(shopUrl);
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch sync history stats",
      error: error.message,
    });
  }
};

export const getSyncHistoryList = async (req, res) => {
  try {
    const { page, limit, status, operationType, shopUrl } = req.query;
    const result = await adminService.getSyncHistoryList({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      status: status || "all",
      operationType: operationType || "all",
      shopUrl: shopUrl || null,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch sync history",
      error: error.message,
    });
  }
};