import { prisma } from "../config/database.js";

export const productSavedSegmentRepository = {
  list(shop) {
    return prisma.productSavedSegment.findMany({
      where: { shop },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
  },

  upsert(shop, data) {
    return prisma.productSavedSegment.upsert({
      where: {
        shop_name: {
          shop,
          name: data.name,
        },
      },
      update: {
        filters: data.filters,
        search: data.search || "",
        sort: data.sort || null,
        destinations: data.destinations || [],
      },
      create: {
        shop,
        name: data.name,
        filters: data.filters,
        search: data.search || "",
        sort: data.sort || null,
        destinations: data.destinations || [],
      },
    });
  },

  delete(shop, id) {
    return prisma.productSavedSegment.deleteMany({
      where: { shop, id },
    });
  },
};
