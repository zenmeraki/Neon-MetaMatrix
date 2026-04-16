import { prisma } from "../Config/database.js";

const getClient = (client = prisma) => client || prisma;

export const findActiveManualExportByIdempotencyKey = async ({
  shop,
  filename,
  idempotencyKey,
  executionStates,
  statuses,
  client = prisma,
}) => {
  const db = getClient(client);

  return db.exportJob.findFirst({
    where: {
      shop,
      filename,
      idempotencyKey,
      isScheduled: false,
      triggerType: "MANUAL",
      executionState: { in: executionStates },
      status: { in: statuses },
    },
    orderBy: { createdAt: "desc" },
  });
};

export const findActiveExportForShop = async ({
  shop,
  executionStates,
  statuses,
  excludeIdempotencyKey = null,
  client = prisma,
}) => {
  const db = getClient(client);

  return db.exportJob.findFirst({
    where: {
      shop,
      executionState: { in: executionStates },
      status: { in: statuses },
      ...(excludeIdempotencyKey
        ? {
            OR: [
              { idempotencyKey: null },
              { NOT: { idempotencyKey: excludeIdempotencyKey } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "asc" },
  });
};

export const createManualExportJob = async ({
  shop,
  filename,
  fields,
  filterQuery,
  status,
  executionState,
  targetCatalogBatchId,
  targetMirrorBatchId,
  filterVersion,
  canonicalFilterKey,
  idempotencyKey,
  client = prisma,
}) => {
  const db = getClient(client);

  return db.exportJob.create({
    data: {
      shop,
      filename,
      fields,
      filterQuery,
      status,
      executionState,
      targetCatalogBatchId: targetCatalogBatchId || targetMirrorBatchId || null,
      targetMirrorBatchId,
      filterVersion,
      canonicalFilterKey,
      idempotencyKey,
    },
  });
};

export const markExportJobQueued = async ({
  id,
  targetSnapshotCount,
  targetSnapshotSetId,
  executionState,
  client = prisma,
}) => {
  const db = getClient(client);

  return db.exportJob.update({
    where: { id },
    data: {
      targetSnapshotCount,
      targetSnapshotSetId,
      executionState,
    },
  });
};

export const markExportJobQueueDispatchFailed = async ({
  id,
  shop,
  queuedState,
  failedState,
  error,
  client = prisma,
}) => {
  const db = getClient(client);

  return db.exportJob.updateMany({
    where: {
      id,
      shop,
      executionState: queuedState,
    },
    data: {
      executionState: failedState,
      status: "FAILED",
      failureStage: "queue_dispatch",
      error: error || "Failed to enqueue export job",
    },
  });
};

export const listExportJobsForShop = async ({
  shop,
  take = 10,
  client = prisma,
}) => {
  const db = getClient(client);

  return db.exportJob.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take,
  });
};

export const findExportJobForShop = async ({
  id,
  shop,
  client = prisma,
}) => {
  const db = getClient(client);

  return db.exportJob.findFirst({
    where: {
      id,
      shop,
    },
  });
};
