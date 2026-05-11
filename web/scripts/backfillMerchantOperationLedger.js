import { prisma } from "../config/database.js";
import { merchantOperationRepository } from "../repositories/merchantOperationRepository.js";

function mapRunStatus(status) {
  switch (String(status || "").toUpperCase()) {
    case "PROCESSING":
      return "DISPATCHING";
    case "SUCCESS":
    case "COMPLETED":
      return "COMPLETED";
    case "FAILED":
      return "FAILED";
    case "SKIPPED":
    case "CANCELLED":
      return "CANCELLED";
    default:
      return "PLANNED";
  }
}

async function backfillEditHistories() {
  const rows = await prisma.editHistory.findMany({
    select: {
      id: true,
      shop: true,
      operationId: true,
      status: true,
      executionState: true,
      totalItems: true,
      processedCount: true,
      type: true,
      startedAt: true,
      completedAt: true,
    },
  });

  for (const row of rows) {
    await merchantOperationRepository.createForEditHistory(row);
  }
  return rows.length;
}

async function backfillExportHistories() {
  const rows = await prisma.exportHistory.findMany({
    select: {
      id: true,
      shop: true,
      operationId: true,
      status: true,
      type: true,
      totalItems: true,
      filename: true,
      exportTime: true,
      createdAt: true,
      errorMessage: true,
    },
  });
  for (const row of rows) {
    await merchantOperationRepository.createForExportHistory(row);
  }
  return rows.length;
}

async function backfillScheduledExportRuns() {
  const runs = await prisma.scheduledExportRun.findMany({
    where: { operationId: null },
    select: {
      id: true,
      shop: true,
      status: true,
      startedAt: true,
      completedAt: true,
      scheduledFor: true,
      totalItems: true,
      scheduledExportId: true,
    },
  });

  for (const run of runs) {
    const operationId = `op_scheduled_export_run_${run.id}`;
    await prisma.merchantOperation.upsert({
      where: {
        shop_idempotencyKey: {
          shop: run.shop,
          idempotencyKey: `scheduled-export-run:${run.id}`,
        },
      },
      update: {
        status: mapRunStatus(run.status),
        startedAt: run.startedAt || run.scheduledFor,
        completedAt: run.completedAt || null,
        totalItems: Number(run.totalItems || 0),
        processedItems: mapRunStatus(run.status) === "COMPLETED" ? Number(run.totalItems || 0) : 0,
      },
      create: {
        id: operationId,
        shop: run.shop,
        type: "SCHEDULED_EXPORT",
        status: mapRunStatus(run.status),
        title: "Scheduled export run",
        source: "legacy_backfill",
        idempotencyKey: `scheduled-export-run:${run.id}`,
        startedAt: run.startedAt || run.scheduledFor,
        completedAt: run.completedAt || null,
        totalItems: Number(run.totalItems || 0),
        processedItems: mapRunStatus(run.status) === "COMPLETED" ? Number(run.totalItems || 0) : 0,
      },
    });
    await prisma.scheduledExportRun.update({
      where: { id: run.id },
      data: { operationId },
    });
  }
  return runs.length;
}

async function backfillRecurringRuns() {
  const runs = await prisma.recurringEditRun.findMany({
    where: { operationId: null },
    select: {
      id: true,
      shop: true,
      status: true,
      startedAt: true,
      completedAt: true,
      scheduledFor: true,
      editHistoryId: true,
      recurringEditId: true,
    },
  });

  for (const run of runs) {
    const operationId = `op_recurring_run_${run.id}`;
    await prisma.merchantOperation.upsert({
      where: {
        shop_idempotencyKey: {
          shop: run.shop,
          idempotencyKey: `recurring-run:${run.id}`,
        },
      },
      update: {
        status: mapRunStatus(run.status),
        startedAt: run.startedAt || run.scheduledFor,
        completedAt: run.completedAt || null,
      },
      create: {
        id: operationId,
        shop: run.shop,
        type: "SCHEDULED_EDIT",
        status: mapRunStatus(run.status),
        title: "Recurring edit run",
        source: "legacy_backfill",
        idempotencyKey: `recurring-run:${run.id}`,
        startedAt: run.startedAt || run.scheduledFor,
        completedAt: run.completedAt || null,
      },
    });
    await prisma.recurringEditRun.update({
      where: { id: run.id },
      data: { operationId },
    });
  }
  return runs.length;
}

async function backfillSpreadsheetFiles() {
  const rows = await prisma.spreadsheetFile.findMany({
    where: { operationId: null },
    select: {
      id: true,
      shop: true,
      editHistoryId: true,
      createdAt: true,
      totalRows: true,
    },
  });

  for (const row of rows) {
    if (row.editHistoryId) {
      const history = await prisma.editHistory.findUnique({
        where: { id: row.editHistoryId },
        select: { operationId: true },
      });
      if (history?.operationId) {
        await prisma.spreadsheetFile.update({
          where: { id: row.id },
          data: { operationId: history.operationId },
        });
        continue;
      }
    }

    const operationId = `op_import_${row.id}`;
    await prisma.merchantOperation.upsert({
      where: {
        shop_idempotencyKey: {
          shop: row.shop || "unknown",
          idempotencyKey: `import-file:${row.id}`,
        },
      },
      update: {},
      create: {
        id: operationId,
        shop: row.shop || "unknown",
        type: "IMPORT",
        status: "COMPLETED",
        title: "Import file",
        source: "legacy_backfill",
        idempotencyKey: `import-file:${row.id}`,
        startedAt: row.createdAt,
        completedAt: row.createdAt,
        totalItems: Number(row.totalRows || 0),
        processedItems: Number(row.totalRows || 0),
      },
    });
    await prisma.spreadsheetFile.update({
      where: { id: row.id },
      data: { operationId },
    });
  }
  return rows.length;
}

async function backfillUndoExecutions() {
  const rows = await prisma.bulkUndoExecution.findMany({
    where: { operationId: null },
    select: {
      id: true,
      shop: true,
      historyId: true,
      executionIdentity: true,
      state: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  for (const row of rows) {
    const history = await prisma.editHistory.findUnique({
      where: { id: row.historyId },
      select: { operationId: true },
    });
    const operationId = `op_undo_${row.executionIdentity}`;
    await prisma.merchantOperation.upsert({
      where: {
        shop_idempotencyKey: {
          shop: row.shop,
          idempotencyKey: `undo:${row.historyId}:${row.executionIdentity}`,
        },
      },
      update: {
        status: mapRunStatus(row.state),
        parentId: history?.operationId || null,
      },
      create: {
        id: operationId,
        shop: row.shop,
        type: "BULK_UNDO",
        status: mapRunStatus(row.state),
        title: "Undo execution",
        source: "legacy_backfill",
        parentId: history?.operationId || null,
        idempotencyKey: `undo:${row.historyId}:${row.executionIdentity}`,
        startedAt: row.createdAt,
        completedAt: ["COMPLETED", "FAILED", "CANCELLED"].includes(mapRunStatus(row.state))
          ? row.updatedAt
          : null,
      },
    });
    await prisma.bulkUndoExecution.update({
      where: { id: row.id },
      data: { operationId },
    });
  }
  return rows.length;
}

async function main() {
  const result = {
    editHistories: await backfillEditHistories(),
    exportHistories: await backfillExportHistories(),
    scheduledExportRuns: await backfillScheduledExportRuns(),
    recurringRuns: await backfillRecurringRuns(),
    spreadsheetFiles: await backfillSpreadsheetFiles(),
    undoExecutions: await backfillUndoExecutions(),
  };
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

