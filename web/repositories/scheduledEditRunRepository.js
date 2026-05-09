import { prisma } from "../config/database.js";

function getClient(db) {
  return db || prisma;
}

export const scheduledEditRunRepository = {
  async create(data, db = prisma) {
    return getClient(db).scheduledEditRun.create({ data });
  },

  async findById(id, db = prisma) {
    return getClient(db).scheduledEditRun.findUnique({ where: { id } });
  },

  async markStarted(id, operationId, db = prisma) {
    return getClient(db).scheduledEditRun.update({
      where: { id },
      data: {
        operationId,
        status: "AWAITING_SHOPIFY",
        startedAt: new Date(),
      },
    });
  },

  async markCreating(id, shop, db = prisma) {
    return getClient(db).scheduledEditRun.updateMany({
      where: {
        id,
        shop,
        operationId: null,
        status: "CLAIMED",
      },
      data: {
        status: "EXECUTING",
        updatedAt: new Date(),
      },
    });
  },

  async markStartedIfUnlinked(id, shop, operationId, db = prisma) {
    return getClient(db).scheduledEditRun.updateMany({
      where: {
        id,
        shop,
        operationId: null,
        status: "EXECUTING",
      },
      data: {
        operationId,
        status: "AWAITING_SHOPIFY",
        startedAt: new Date(),
      },
    });
  },

  async resetCreatingToClaimed(id, shop, db = prisma) {
    return getClient(db).scheduledEditRun.updateMany({
      where: {
        id,
        shop,
        operationId: null,
        status: "EXECUTING",
      },
      data: {
        status: "CLAIMED",
        updatedAt: new Date(),
      },
    });
  },

  async claimPending(id, { shop, scheduledEditId } = {}, db = prisma) {
    return getClient(db).scheduledEditRun.updateMany({
      where: {
        id,
        ...(shop ? { shop } : {}),
        ...(scheduledEditId ? { scheduledEditId } : {}),
        status: "PENDING",
      },
      data: {
        status: "CLAIMED",
        claimedAt: new Date(),
      },
    });
  },

  async markFailed(id, { errorCode, errorMessage }, db = prisma) {
    return getClient(db).scheduledEditRun.update({
      where: { id },
      data: {
        status: "FAILED",
        failedAt: new Date(),
        errorCode,
        errorMessage,
      },
    });
  },

  async markCompleted(id, db = prisma) {
    return getClient(db).scheduledEditRun.update({
      where: { id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });
  },

  async findLatestByScheduledEditId(scheduledEditId, shop, db = prisma) {
    return getClient(db).scheduledEditRun.findFirst({
      where: {
        scheduledEditId,
        shop,
      },
      orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }],
    });
  },

  async cancelPendingByScheduledEditId(scheduledEditId, shop, db = prisma) {
    return getClient(db).scheduledEditRun.updateMany({
      where: {
        scheduledEditId,
        shop,
        status: "PENDING",
      },
      data: {
        status: "CANCELLED",
        updatedAt: new Date(),
      },
    });
  },
};

export async function claimDueScheduledEdits(limit = 50, db = prisma) {
  return db.$queryRaw`
    UPDATE "ScheduledEditRun"
    SET "claimedAt" = now(),
        "status" = 'CLAIMED',
        "updatedAt" = now()
    WHERE id IN (
      SELECT id
      FROM "ScheduledEditRun"
      WHERE "scheduledFor" <= now()
        AND "status" = 'PENDING'
      ORDER BY "scheduledFor"
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING *;
  `;
}
