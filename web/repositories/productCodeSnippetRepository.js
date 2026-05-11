import { prisma } from "../config/database.js";

function getClient(db) {
  return db || prisma;
}

export const productCodeSnippetRepository = {
  async create(data, db = prisma) {
    return getClient(db).productCodeSnippet.create({ data });
  },

  async findById(id, db = prisma) {
    return getClient(db).productCodeSnippet.findUnique({
      where: { id },
    });
  },

  async findByIdForShop(id, shop, db = prisma) {
    return getClient(db).productCodeSnippet.findFirst({
      where: {
        id,
        shop,
        isDeleted: false,
      },
    });
  },

  async listByShop({ shop, search = "", status = null }, db = prisma) {
    return getClient(db).productCodeSnippet.findMany({
      where: {
        shop,
        isDeleted: false,
        ...(status ? { status } : {}),
        ...(search
          ? {
              title: {
                contains: search,
                mode: "insensitive",
              },
            }
          : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });
  },

  async updateById(id, data, db = prisma) {
    return getClient(db).productCodeSnippet.update({
      where: { id },
      data,
    });
  },

  async updateByIdForShopWithUpdatedAt({
    id,
    shop,
    expectedUpdatedAt,
    data,
  }, db = prisma) {
    return getClient(db).productCodeSnippet.updateMany({
      where: {
        id,
        shop,
        isDeleted: false,
        ...(expectedUpdatedAt ? { updatedAt: new Date(expectedUpdatedAt) } : {}),
      },
      data,
    });
  },
};
