import { prisma } from "../config/database.js";

function getClient(db) {
  return db || prisma;
}

const TYPE_BY_EDIT_HISTORY = {
  "Scheduled edit": "SCHEDULED_EDIT",
};

const STATUS_BY_EXECUTION_STATE = {
  planned: "PLANNED",
  freezing: "SNAPSHOTTING",
  snapshooting: "SNAPSHOTTING",
  queued: "SNAPSHOTTED",
  frozen: "SNAPSHOTTED",
  dispatching: "DISPATCHING",
  submitting: "DISPATCHING",
  awaiting_shopify: "AWAITING_SHOPIFY",
  awaiting_shopify_results: "AWAITING_SHOPIFY",
  finalizing: "APPLYING_RESULTS",
  completed: "COMPLETED",
  failed: "FAILED",
  cancelled: "CANCELLED",
};

function mapEditHistoryType(type) {
  return TYPE_BY_EDIT_HISTORY[type] || "BULK_EDIT";
}

function mapExecutionStateToOperationStatus(executionState, fallbackStatus = null) {
  if (executionState && STATUS_BY_EXECUTION_STATE[executionState]) {
    return STATUS_BY_EXECUTION_STATE[executionState];
  }
  if (fallbackStatus === "completed") return "COMPLETED";
  if (fallbackStatus === "failed") return "FAILED";
  if (fallbackStatus === "cancelled") return "CANCELLED";
  return "PLANNED";
}

export const merchantOperationRepository = {
  async createPlannedOperation({
    id = null,
    shop,
    type,
    title,
    source = "write_through",
    idempotencyKey,
    totalItems = 0,
    startedAt = null,
  }, db = prisma) {
    if (!shop) throw new Error("shop is required");
    if (!type) throw new Error("type is required");
    if (!idempotencyKey) throw new Error("idempotencyKey is required");
    const client = getClient(db);
    return client.merchantOperation.upsert({
      where: {
        shop_idempotencyKey: {
          shop,
          idempotencyKey,
        },
      },
      update: {
        status: "PLANNED",
        totalItems: Number(totalItems || 0),
      },
      create: {
        ...(id ? { id } : {}),
        shop,
        type,
        status: "PLANNED",
        title: title || "Operation",
        source,
        idempotencyKey,
        totalItems: Number(totalItems || 0),
        startedAt: startedAt || null,
      },
    });
  },

  async createPlannedOperationForEdit({
    shop,
    type = "BULK_EDIT",
    title = "Bulk edit",
    source = "write_through",
    idempotencyKey,
    totalItems = 0,
    startedAt = null,
  }, db = prisma) {
    return this.createPlannedOperation(
      { shop, type, title, source, idempotencyKey, totalItems, startedAt },
      db,
    );
  },

  async createForEditHistory(editHistory, db = prisma) {
    const client = getClient(db);
    const operationId = editHistory.operationId || `op_edit_${editHistory.id}`;
    const created = await client.merchantOperation.upsert({
      where: {
        shop_idempotencyKey: {
          shop: editHistory.shop,
          idempotencyKey: `edit-history:${editHistory.id}`,
        },
      },
      update: {
        status: mapExecutionStateToOperationStatus(editHistory.executionState, editHistory.status),
        totalItems: Number(editHistory.totalItems || 0),
        processedItems: Number(editHistory.processedCount || 0),
      },
      create: {
        id: operationId,
        shop: editHistory.shop,
        type: mapEditHistoryType(editHistory.type),
        status: mapExecutionStateToOperationStatus(editHistory.executionState, editHistory.status),
        title: typeof editHistory.type === "string" ? editHistory.type : "Bulk edit",
        source: "dual_write",
        idempotencyKey: `edit-history:${editHistory.id}`,
        totalItems: Number(editHistory.totalItems || 0),
        processedItems: Number(editHistory.processedCount || 0),
        failedItems: Math.max(
          Number(editHistory.totalItems || 0) - Number(editHistory.processedCount || 0),
          0,
        ),
        startedAt: editHistory.startedAt || null,
        completedAt: editHistory.completedAt || null,
      },
    });

    if (!editHistory.operationId) {
      await client.editHistory.update({
        where: { id: editHistory.id },
        data: { operationId: created.id },
      });
    }

    return created;
  },

  async createForExportHistory(exportHistory, db = prisma) {
    const client = getClient(db);
    const operationId = exportHistory.operationId || `op_export_${exportHistory.id}`;
    const type = exportHistory.type === "Scheduled export" ? "SCHEDULED_EXPORT" : "EXPORT";
    const status = exportHistory.status === "completed"
      ? "COMPLETED"
      : exportHistory.status === "failed"
        ? "FAILED"
        : "PLANNED";

    const created = await client.merchantOperation.upsert({
      where: {
        shop_idempotencyKey: {
          shop: exportHistory.shop,
          idempotencyKey: `export-history:${exportHistory.id}`,
        },
      },
      update: {
        status,
        totalItems: Number(exportHistory.totalItems || 0),
        processedItems: status === "COMPLETED" ? Number(exportHistory.totalItems || 0) : 0,
      },
      create: {
        id: operationId,
        shop: exportHistory.shop,
        type,
        status,
        title: exportHistory.filename || "Export",
        source: "dual_write",
        idempotencyKey: `export-history:${exportHistory.id}`,
        totalItems: Number(exportHistory.totalItems || 0),
        processedItems: status === "COMPLETED" ? Number(exportHistory.totalItems || 0) : 0,
        failedItems: status === "FAILED" ? Number(exportHistory.totalItems || 0) : 0,
        startedAt: exportHistory.createdAt || null,
        completedAt: exportHistory.exportTime || null,
        errorMessage: exportHistory.errorMessage || null,
      },
    });

    if (!exportHistory.operationId) {
      await client.exportHistory.update({
        where: { id: exportHistory.id },
        data: { operationId: created.id },
      });
    }

    return created;
  },

  async transitionById(operationId, shop, data, db = prisma) {
    if (Object.hasOwn(data || {}, "status")) {
      throw new Error("MERCHANT_OPERATION_STATUS_TRANSITION_REQUIRES_OPERATION_SERVICE");
    }
    return getClient(db).merchantOperation.updateMany({
      where: {
        id: operationId,
        shop,
      },
      data,
    });
  },
};
