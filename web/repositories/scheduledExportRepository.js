import { prisma } from "../Config/database.js";

function getClient(db) {
  return db || prisma;
}

export const scheduledExportRepository = {
  async create(data, db = prisma) {
    return getClient(db).scheduledExport.create({ data });
  },

  async findById(id, db = prisma) {
    return getClient(db).scheduledExport.findUnique({
      where: { id },
    });
  },

  async findByIdForShop(id, shop, db = prisma) {
    return getClient(db).scheduledExport.findFirst({
      where: {
        id,
        shop,
        isDeleted: false,
      },
    });
  },

  async listByShop(shop, db = prisma) {
    return getClient(db).scheduledExport.findMany({
      where: {
        shop,
        isDeleted: false,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  },

  async updateById(id, data, db = prisma) {
    return getClient(db).scheduledExport.update({
      where: { id },
      data,
    });
  },

  async findDueScheduledExportIds(now, limit = 100, db = prisma) {
    return getClient(db).scheduledExport.findMany({
      where: {
        isDeleted: false,
        status: "ACTIVE",
        nextRunAt: {
          lte: now,
        },
      },
      select: {
        id: true,
      },
      orderBy: [{ nextRunAt: "asc" }, { createdAt: "asc" }],
      take: limit,
    });
  },
};
