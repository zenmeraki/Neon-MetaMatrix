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

export async function findDistinctProductFieldValues({
  shop,
  field,
  search = "",
  take = 20,
}) {
  return prisma.product.findMany({
    where: {
      shop,
      NOT: [{ [field]: null }, { [field]: "" }],
      ...(search
        ? {
            [field]: {
              contains: search,
              mode: "insensitive",
            },
          }
        : {}),
    },
    select: {
      [field]: true,
    },
    distinct: [field],
    orderBy: {
      [field]: "asc",
    },
    take,
  });
}
