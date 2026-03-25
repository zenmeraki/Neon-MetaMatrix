import { prisma } from "../../config/database.js";

export async function findProductsForListing({ where, orderBy, skip, take }) {
  return prisma.product.findMany({
    where,
    select: {
      title: true,
      id: true,
      status: true,
      productType: true,
      vendor: true,
      totalInventory: true,
      featuredImageUrl: true,
      categoryName: true,
      handle: true,
      templateSuffix: true,
      variantCount: true,
      visibleOnlineStore: true,
    },
    orderBy,
    skip,
    take,
  });
}

export async function countProducts(where) {
  return prisma.product.count({ where });
}
