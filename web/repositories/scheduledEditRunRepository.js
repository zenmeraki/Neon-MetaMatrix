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
        status: "RUNNING",
        startedAt: new Date(),
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
