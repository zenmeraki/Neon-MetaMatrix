import { prisma } from "../Config/database.js";

const getClient = (client = prisma) => client || prisma;

export async function findEditStatusSummaryByShop({
  id,
  shop,
  client = prisma,
}) {
  const db = getClient(client);

  return db.editHistory.findFirst({
    where: {
      id,
      shop,
    },
    select: {
      processedCount: true,
      totalItems: true,
      durationMs: true,
    },
  });
}

export async function findActiveScheduledEditByIdempotencyKey({
  shop,
  idempotencyKey,
  client = prisma,
}) {
  const db = getClient(client);

  return db.editHistory.findFirst({
    where: {
      shop,
      idempotencyKey,
      type: "Scheduled edit",
      status: {
        in: ["pending", "processing"],
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function createScheduledEditHistory({
  data,
  client = prisma,
}) {
  const db = getClient(client);

  return db.editHistory.create({ data });
}

export async function attachScheduledEditTargetSnapshot({
  id,
  shop,
  targetSnapshotCount,
  targetSnapshotSetId,
  batch,
  client = prisma,
}) {
  const db = getClient(client);

  return db.editHistory.update({
    where: { id },
    data: {
      totalItems: targetSnapshotCount,
      targetSnapshotCount,
      targetSnapshotSetId,
      batch,
    },
  });
}

export async function markScheduledEditQueueDispatchFailed({
  id,
  shop,
  error,
  client = prisma,
}) {
  const db = getClient(client);

  return db.editHistory.updateMany({
    where: {
      id,
      shop,
      executionState: "planned",
    },
    data: {
      status: "failed",
      executionState: "failed",
      failureStage: "scheduled_queue_dispatch",
      error: {
        message: error || "Failed to enqueue scheduled edit job",
      },
    },
  });
}
