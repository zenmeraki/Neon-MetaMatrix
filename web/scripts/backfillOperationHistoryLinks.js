import { prisma } from "../config/database.js";
import { merchantOperationRepository } from "../repositories/merchantOperationRepository.js";

async function backfillEditHistoryOperationLinks() {
  const rows = await prisma.editHistory.findMany({
    where: { operationId: null },
    orderBy: { createdAt: "asc" },
  });

  let linked = 0;
  for (const row of rows) {
    await merchantOperationRepository.createForEditHistory(row, prisma);
    linked += 1;
  }

  return { scanned: rows.length, linked };
}

async function backfillExportHistoryOperationLinks() {
  const rows = await prisma.exportHistory.findMany({
    where: { operationId: null },
    orderBy: { createdAt: "asc" },
  });

  let linked = 0;
  for (const row of rows) {
    await merchantOperationRepository.createForExportHistory(row, prisma);
    linked += 1;
  }

  return { scanned: rows.length, linked };
}

async function backfillSpreadsheetFileOperationLinks() {
  const rows = await prisma.spreadsheetFile.findMany({
    where: {
      operationId: null,
      editHistoryId: { not: null },
    },
    select: {
      id: true,
      editHistoryId: true,
    },
  });

  let linked = 0;
  for (const row of rows) {
    const history = await prisma.editHistory.findFirst({
      where: { id: row.editHistoryId },
      select: { operationId: true },
    });

    if (!history?.operationId) continue;

    await prisma.spreadsheetFile.update({
      where: { id: row.id },
      data: { operationId: history.operationId },
    });
    linked += 1;
  }

  return { scanned: rows.length, linked };
}

async function main() {
  const editResult = await backfillEditHistoryOperationLinks();
  const exportResult = await backfillExportHistoryOperationLinks();
  const spreadsheetResult = await backfillSpreadsheetFileOperationLinks();

  console.log(
    JSON.stringify(
      {
        ok: true,
        editResult,
        exportResult,
        spreadsheetResult,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: error?.message || String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

