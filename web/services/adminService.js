// services/AdminService.js
// ❌ Old Mongoose imports – remove these:
// import Store from "../schema/Store.js";
// import EditHistory from "../schema/editHistorySchema.js";
// import SyncHistory from "../schema/syncHistory.js";

// ✅ Prisma
import { prisma } from "../config/database.js";
import { isStaleSyncExecution } from "./syncRepairService.js";
import { enrichEditHistoriesWithTargetingMetadata } from "./historyTargetingMetadataService.js";


class AdminService {
  // ==================== STORE ANALYTICS ====================

  async getStoreStats() {
    const [totalStores, installedStores, uninstalledStores] =
      await Promise.all([
        prisma.store.count(),
        prisma.store.count({
          where: { isUnInstalled: false },
        }),
        prisma.store.count({
          where: { isUnInstalled: true },
        }),
      ]);

    return {
      totalStores,
      installedStores,
      uninstalledStores,
      installRate:
        totalStores > 0
          ? ((installedStores / totalStores) * 100).toFixed(2)
          : 0,
    };
  }

  async getAllStores({ page = 1, limit = 20, status = "all", search = "" }) {
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 20);
    const skip = (pageNum - 1) * limitNum;

    const where = {};

    // Filter by installation status
    if (status === "installed") {
      where.isUnInstalled = false;
    } else if (status === "uninstalled") {
      where.isUnInstalled = true;
    }

    // Search by shop URL or email
    if (search && search.trim()) {
      where.OR = [
        {
          shopUrl: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          shopEmail: {
            contains: search,
            mode: "insensitive",
          },
        },
      ];
    }

    const [stores, total] = await Promise.all([
      prisma.store.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.store.count({ where }),
    ]);

    return {
      stores,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
      },
    };
  }

  async getStoreDetails(shopUrl) {
    const store = await prisma.store.findUnique({
      where: { shopUrl },
    });

    if (!store) {
      throw new Error("Store not found");
    }

    const whereShop = { shop: shopUrl };

    const [editHistoryCount, syncHistoryCount, lastEdit, lastSync] =
      await Promise.all([
        prisma.editHistory.count({ where: whereShop }),
        prisma.syncHistory.count({ where: whereShop }),
        prisma.editHistory.findFirst({
          where: whereShop,
          orderBy: { editTime: "desc" },
        }),
        prisma.syncHistory.findFirst({
          where: whereShop,
          orderBy: { createdAt: "desc" },
        }),
      ]);

    return {
      store,
      stats: {
        totalEdits: editHistoryCount,
        totalSyncs: syncHistoryCount,
        lastEditDate: lastEdit?.editTime || null,
        lastSyncDate: lastSync?.createdAt || null,
      },
    };
  }

  // ==================== EDIT HISTORY ANALYTICS ====================

  async getEditHistoryStats(shopUrl = null) {
    const where = shopUrl ? { shop: shopUrl } : {};

    const [statusGroups, typeGroups, totalRecords] = await Promise.all([
      prisma.editHistory.groupBy({
        by: ["status"],
        _count: { _all: true },
        where,
      }),
      prisma.editHistory.groupBy({
        by: ["type"],
        _count: { _all: true },
        where,
      }),
      prisma.editHistory.count({ where }),
    ]);

    // Format status counts
    const statusMap = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      scheduled: 0,
      "undo pending": 0,
      "undo processing": 0,
      "undo completed": 0,
    };

    statusGroups.forEach((g) => {
      const key = (g.status || "").toLowerCase();
      if (key in statusMap) {
        statusMap[key] = g._count._all;
      }
    });

    // Format type counts
    const typeMap = {
      "Manual edit": 0,
      "Scheduled edit": 0,
      "Recurring edit": 0,
    };

    typeGroups.forEach((g) => {
      const key = g.type || "";
      if (key in typeMap) {
        typeMap[key] = g._count._all;
      }
    });

    return {
      total: totalRecords,
      byStatus: statusMap,
      byType: typeMap,
      successRate:
        totalRecords > 0
          ? ((statusMap.completed / totalRecords) * 100).toFixed(2)
          : 0,
    };
  }

  async getEditHistoryList({
    page = 1,
    limit = 20,
    status = "all",
    type = "all",
    shopUrl = null,
    sortBy = "editTime",
    sortOrder = "desc",
  }) {
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 20);
    const skip = (pageNum - 1) * limitNum;

    const where = {};
    if (shopUrl) where.shop = shopUrl;
    if (status !== "all") where.status = status;
    if (type !== "all") where.type = type;

    // Whitelist sortable fields
    const sortFieldMap = {
      editTime: "editTime",
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    };
    const sortField = sortFieldMap[sortBy] || "editTime";
    const direction = sortOrder === "asc" ? "asc" : "desc";

    const [editHistories, total] = await Promise.all([
      prisma.editHistory.findMany({
        where,
        orderBy: { [sortField]: direction },
        skip,
        take: limitNum,
      }),
      prisma.editHistory.count({ where }),
    ]);

    const enrichedEditHistories = await enrichEditHistoriesWithTargetingMetadata(editHistories);

    return {
      editHistories: enrichedEditHistories,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
      },
    };
  }

  async getFailedEdits({ page = 1, limit = 20, shopUrl = null }) {
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 20);
    const skip = (pageNum - 1) * limitNum;

    const where = { status: "failed" };
    if (shopUrl) where.shop = shopUrl;

    const [failedEdits, total] = await Promise.all([
      prisma.editHistory.findMany({
        where,
        orderBy: { editTime: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.editHistory.count({ where }),
    ]);

    // Group error codes in JS (error is Json[] in Prisma)
    const failedForGrouping = await prisma.editHistory.findMany({
      where,
      select: {
        error: true,
        shop: true,
      },
      // optional: safety cap so we don't scan millions of rows for admin analytics
      take: 1000,
    });

    const errorGroupsMap = new Map();

    for (const rec of failedForGrouping) {
      const errors = Array.isArray(rec.error) ? rec.error : [];
      for (const e of errors) {
        if (!e) continue;
        const code = e.code || "UNKNOWN";
        let group = errorGroupsMap.get(code);
        if (!group) {
          group = {
            errorCode: code,
            count: 0,
            samples: [],
          };
          errorGroupsMap.set(code, group);
        }
        group.count += 1;
        if (group.samples.length < 3) {
          group.samples.push({
            message: e.message,
            shop: rec.shop,
          });
        }
      }
    }

    const errorGroups = Array.from(errorGroupsMap.values()).sort(
      (a, b) => b.count - a.count,
    );

    return {
      failedEdits,
      errorGroups,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
      },
    };
  }

  // ==================== SYNC HISTORY ANALYTICS ====================

  async getSyncHistoryStats(shopUrl = null) {
    const where = shopUrl ? { shop: shopUrl } : {};

    const [statusGroups, operationGroups, totalRecords, avgAgg, activeSyncRows] =
      await Promise.all([
        prisma.syncHistory.groupBy({
          by: ["status"],
          _count: { _all: true },
          where,
        }),
        prisma.syncHistory.groupBy({
          by: ["operationType"],
          _count: { _all: true },
          where,
        }),
        prisma.syncHistory.count({ where }),
        prisma.syncHistory.aggregate({
          _avg: { duration: true },
          where: { ...where, status: "completed" },
        }),
        prisma.syncHistory.findMany({
          where: {
            ...where,
            status: "processing",
          },
          select: {
            id: true,
            executionState: true,
            lastHeartbeatAt: true,
            updatedAt: true,
          },
          take: 200,
        }),
      ]);

    const statusMap = {
      completed: 0,
      processing: 0,
      failed: 0,
    };

    statusGroups.forEach((g) => {
      const key = g.status; // SyncStatus enum
      if (key in statusMap) {
        statusMap[key] = g._count._all;
      }
    });

    // In Prisma enum we have: Collection, ProductType, Product
    // Old analytics used label "Product Type" with a space
    const operationMap = {
      Collection: 0,
      "Product Type": 0,
      Product: 0,
    };

    operationGroups.forEach((g) => {
      const raw = g.operationType;
      if (!raw) return;
      const label = raw === "ProductType" ? "Product Type" : raw;
      if (label in operationMap) {
        operationMap[label] = g._count._all;
      }
    });

    const averageDuration = avgAgg._avg.duration || 0;

    return {
      total: totalRecords,
      byStatus: statusMap,
      byOperationType: operationMap,
      averageDuration,
      stuckProcessingCount: activeSyncRows.filter((row) => isStaleSyncExecution(row)).length,
      successRate:
        totalRecords > 0
          ? ((statusMap.completed / totalRecords) * 100).toFixed(2)
          : 0,
    };
  }

  async getSyncHistoryList({
    page = 1,
    limit = 20,
    status = "all",
    operationType = "all",
    shopUrl = null,
  }) {
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 20);
    const skip = (pageNum - 1) * limitNum;

    const where = {};
    if (shopUrl) where.shop = shopUrl;
    if (status !== "all") where.status = status;

    if (operationType !== "all") {
      // API uses "Product Type" but DB uses enum ProductType
      where.operationType =
        operationType === "Product Type" ? "ProductType" : operationType;
    }

    const [syncHistories, total] = await Promise.all([
      prisma.syncHistory.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.syncHistory.count({ where }),
    ]);

    const enrichedSyncHistories = await Promise.all(
      syncHistories.map(async (history) => {
        const rows = await prisma.$queryRaw`
          SELECT
            "executionState",
            "executionIdentity",
            "lastHeartbeatAt",
            "completedAt"
          FROM "SyncHistory"
          WHERE "id" = ${history.id}
          LIMIT 1
        `;
        const execution = rows?.[0] || null;

        return {
          ...history,
          executionState: execution?.executionState || null,
          executionIdentity: execution?.executionIdentity || null,
          lastHeartbeatAt: execution?.lastHeartbeatAt || null,
          completedAt: execution?.completedAt || history.completedAt || null,
          stuckDetected: isStaleSyncExecution({
            executionState: execution?.executionState || null,
            lastHeartbeatAt: execution?.lastHeartbeatAt || null,
            updatedAt: history.updatedAt,
          }),
        };
      }),
    );

    return {
      syncHistories: enrichedSyncHistories,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
      },
    };
  }

  // ==================== DASHBOARD OVERVIEW ====================

  async getDashboardOverview() {
    const [storeStats, editStats, syncStats, recentActivity] =
      await Promise.all([
        this.getStoreStats(),
        this.getEditHistoryStats(),
        this.getSyncHistoryStats(),
        this.getRecentActivity(),
      ]);

    return {
      stores: storeStats,
      edits: editStats,
      syncs: syncStats,
      recentActivity,
    };
  }

  async getRecentActivity(limit = 10) {
    const limitNum = Math.max(1, Number(limit) || 10);

    const [recentEdits, recentSyncs, recentInstalls, recentUninstalls] =
      await Promise.all([
        prisma.editHistory.findMany({
          orderBy: { editTime: "desc" },
          take: limitNum,
          select: {
            shop: true,
            status: true,
            type: true,
            editTime: true,
            // There is no top-level "field" column in schema,
            // you can later derive it from "rules" Json if needed.
          },
        }),
        prisma.syncHistory.findMany({
          orderBy: { createdAt: "desc" },
          take: limitNum,
          select: {
            shop: true,
            status: true,
            operationType: true,
            createdAt: true,
          },
        }),
        prisma.store.findMany({
          where: { isUnInstalled: false },
          orderBy: { installedAt: "desc" },
          take: limitNum,
          select: {
            shopUrl: true,
            installedAt: true,
          },
        }),
        prisma.store.findMany({
          where: { isUnInstalled: true },
          orderBy: { unInstalledAt: "desc" },
          take: limitNum,
          select: {
            shopUrl: true,
            unInstalledAt: true,
          },
        }),
      ]);

    return {
      recentEdits,
      recentSyncs,
      recentInstalls,
      recentUninstalls,
    };
  }
}

export default new AdminService();
