import { prisma } from "../config/database.js";

function getClient(db) {
  return db || prisma;
}

export const operationFailureRepository = {
  async create(data, db = prisma) {
    return getClient(db).operationFailure.create({ data });
  },

  async listByOperation(operationId, db = prisma) {
    return getClient(db).operationFailure.findMany({
      where: { operationId },
      orderBy: { createdAt: "asc" },
    });
  },
};
