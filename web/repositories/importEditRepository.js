import { prisma } from "../Config/database.js";

const getClient = (client = prisma) => client || prisma;

export const createImportEditHistoryWithFile = async ({
  shop,
  title,
  executionState,
  executionIdentity,
  undo,
  rules,
  batch,
  columnMappings,
  fileUrl = null,
  client = prisma,
}) => {
  const db = getClient(client);

  const editHistory = await db.editHistory.create({
    data: {
      shop,
      title,
      editedType: "mixed",
      executionState,
      executionIdentity,
      isSpreadsheetEdit: true,
      undo,
      rules,
      batch,
    },
  });

  const spreadsheetFile = await db.spreadsheetFile.create({
    data: {
      shop,
      editHistoryId: editHistory.id,
      fileUrl,
      columnMappings,
      totalRows: 0,
    },
  });

  return { editHistory, spreadsheetFile };
};

export const markImportEditQueued = async ({
  historyId,
  shop,
  queuedState,
  client = prisma,
}) => {
  const db = getClient(client);

  return db.editHistory.updateMany({
    where: {
      id: historyId,
      shop,
    },
    data: {
      executionState: queuedState,
      status: "pending",
    },
  });
};

export const markImportEditQueueDispatchFailed = async ({
  historyId,
  shop,
  failedState,
  error,
  client = prisma,
}) => {
  const db = getClient(client);

  return db.editHistory.updateMany({
    where: {
      id: historyId,
      shop,
    },
    data: {
      executionState: failedState,
      status: "failed",
      failureStage: "queue_dispatch",
      error: {
        message: error || "Failed to enqueue import edit job",
      },
    },
  });
};
