import { prisma } from "../Config/database.js";

/**
 * Collection membership repository.
 *
 * All collection membership reads use the ProductCollectionMembership join table.
 * Product.collectionsJson is compatibility/staging data only and must never be
 * used for targeting, filters, exports, or other trust-critical query-plane reads.
 */

const COLLECTION_MIRROR_SELECT = {
  id: true,
  shop: true,
  shopifyId: true,
  catalogBatchId: true,
  mirrorBatchId: true,
  title: true,
  handle: true,
  createdAt: true,
  updatedAt: true,
};

const DEFAULT_MEMBERSHIP_SELECT = {
  id: true,
  shop: true,
  productId: true,
  collectionId: true,
  catalogBatchId: true,
  createdAt: true,
  updatedAt: true,
};

const assertShop = (shop) => {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required");
  }
};

const assertBatchId = (catalogBatchId) => {
  if (!catalogBatchId || typeof catalogBatchId !== "string") {
    throw new Error("catalogBatchId is required");
  }
};

const buildSelect = (select) => select || DEFAULT_MEMBERSHIP_SELECT;

const getMembershipDelegate = () => {
  if (!prisma.productCollectionMembership) {
    throw new Error(
      "Prisma model productCollectionMembership is not available. Add the membership model and regenerate Prisma Client before using this method.",
    );
  }

  return prisma.productCollectionMembership;
};

/**
 * Current Collection mirror lookup by batch.
 */
export const listCollectionMirrorsByBatch = async ({
  shop,
  catalogBatchId,
  mirrorBatchId,
  search = "",
  take = 100,
}) => {
  assertShop(shop);
  const resolvedCatalogBatchId = catalogBatchId || mirrorBatchId;
  assertBatchId(resolvedCatalogBatchId);

  const safeTake = typeof take === "number" && take > 0
    ? Math.min(take, 500)
    : 100;

  return prisma.collection.findMany({
    where: {
      shop,
      catalogBatchId: resolvedCatalogBatchId,
      ...(search
        ? {
            title: {
              contains: search,
              mode: "insensitive",
            },
          }
        : {}),
    },
    orderBy: [{ title: "asc" }, { shopifyId: "asc" }],
    take: safeTake,
  });
};

export const createManyCollectionMirrors = async (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("rows must be a non-empty array");
  }

  for (const row of rows) {
    assertShop(row?.shop);
    const catalogBatchId = row?.catalogBatchId || row?.mirrorBatchId;
    assertBatchId(catalogBatchId);

    if (!row.shopifyId || typeof row.shopifyId !== "string") {
      throw new Error("shopifyId is required");
    }
  }

  return prisma.collection.createMany({
    data: rows.map((row) => ({
      ...row,
      catalogBatchId: row.catalogBatchId || row.mirrorBatchId,
      mirrorBatchId: row.mirrorBatchId || row.catalogBatchId,
    })),
    skipDuplicates: true,
  });
};

export const deleteCollectionMirrorsByBatch = async ({
  shop,
  catalogBatchId,
  mirrorBatchId,
}) => {
  assertShop(shop);
  const resolvedCatalogBatchId = catalogBatchId || mirrorBatchId;
  assertBatchId(resolvedCatalogBatchId);

  return prisma.collection.deleteMany({
    where: {
      shop,
      catalogBatchId: resolvedCatalogBatchId,
    },
  });
};

export const findCollectionMirrorByShopifyId = async (
  { shop, catalogBatchId, mirrorBatchId, shopifyId },
  options = {},
) => {
  assertShop(shop);
  const resolvedCatalogBatchId = catalogBatchId || mirrorBatchId;
  assertBatchId(resolvedCatalogBatchId);

  if (!shopifyId || typeof shopifyId !== "string") {
    throw new Error("shopifyId is required");
  }

  return prisma.collection.findFirst({
    where: {
      shop,
      catalogBatchId: resolvedCatalogBatchId,
      shopifyId,
    },
    select: options.select || COLLECTION_MIRROR_SELECT,
  });
};

export const countCollectionMirrorsByBatch = async ({
  shop,
  catalogBatchId,
}) => {
  assertShop(shop);
  assertBatchId(catalogBatchId);

  return prisma.collection.count({
    where: {
      shop,
      catalogBatchId,
    },
  });
};

export const createManyCollectionMemberships = async (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("rows must be a non-empty array");
  }

  for (const row of rows) {
    assertShop(row?.shop);

    if (!row.catalogBatchId || typeof row.catalogBatchId !== "string") {
      throw new Error("catalogBatchId is required");
    }

    if (!row.productId || typeof row.productId !== "string") {
      throw new Error("productId is required");
    }

    if (!row.collectionId || typeof row.collectionId !== "string") {
      throw new Error("collectionId is required");
    }
  }

  return getMembershipDelegate().createMany({
    data: rows,
    skipDuplicates: true,
  });
};

export const listCollectionMembershipsByBatch = async (
  { shop, catalogBatchId, collectionId = null, productId = null },
  options = {},
) => {
  assertShop(shop);

  if (!catalogBatchId || typeof catalogBatchId !== "string") {
    throw new Error("catalogBatchId is required");
  }

  return getMembershipDelegate().findMany({
    where: {
      shop,
      catalogBatchId,
      ...(collectionId ? { collectionId } : {}),
      ...(productId ? { productId } : {}),
    },
    orderBy: [{ collectionId: "asc" }, { productId: "asc" }],
    select: buildSelect(options.select),
  });
};

export const findProductIdsByCollectionTitle = async ({
  shop,
  catalogBatchId,
  title,
  operator = "contains",
  take = 10000,
}) => {
  assertShop(shop);

  if (!catalogBatchId || typeof catalogBatchId !== "string") {
    throw new Error("catalogBatchId is required");
  }

  const normalizedTitle = String(title || "").trim();
  const safeTake = typeof take === "number" && take > 0
    ? Math.min(take, 50000)
    : 10000;

  const titleFilter = normalizedTitle
    ? {
        collectionTitle: {
          [operator === "equals" || operator === "is" ? "equals" : "contains"]:
            normalizedTitle,
          mode: "insensitive",
        },
      }
    : {};

  const rows = await getMembershipDelegate().findMany({
    where: {
      shop,
      catalogBatchId,
      ...titleFilter,
    },
    select: {
      productId: true,
    },
    distinct: ["productId"],
    orderBy: [{ productId: "asc" }],
    take: safeTake,
  });

  return rows.map((row) => row.productId).filter(Boolean);
};

export const findProductIdsWithAnyCollection = async ({
  shop,
  catalogBatchId,
  take = 50000,
}) => {
  assertShop(shop);

  if (!catalogBatchId || typeof catalogBatchId !== "string") {
    throw new Error("catalogBatchId is required");
  }

  const safeTake = typeof take === "number" && take > 0
    ? Math.min(take, 50000)
    : 50000;

  const rows = await getMembershipDelegate().findMany({
    where: {
      shop,
      catalogBatchId,
    },
    select: {
      productId: true,
    },
    distinct: ["productId"],
    orderBy: [{ productId: "asc" }],
    take: safeTake,
  });

  return rows.map((row) => row.productId).filter(Boolean);
};

export const findDistinctCollectionTitlesByBatch = async ({
  shop,
  catalogBatchId,
  search = "",
  take = 20,
}) => {
  assertShop(shop);

  if (!catalogBatchId || typeof catalogBatchId !== "string") {
    throw new Error("catalogBatchId is required");
  }

  const safeTake = typeof take === "number" && take > 0
    ? Math.min(take, 100)
    : 20;

  return getMembershipDelegate().findMany({
    where: {
      shop,
      catalogBatchId,
      collectionTitle: {
        not: null,
        ...(search
          ? {
              contains: search,
              mode: "insensitive",
            }
          : {}),
      },
    },
    select: {
      collectionTitle: true,
    },
    distinct: ["collectionTitle"],
    orderBy: [{ collectionTitle: "asc" }],
    take: safeTake,
  });
};

export const deleteCollectionMembershipsByBatch = async ({
  shop,
  catalogBatchId,
}) => {
  assertShop(shop);

  if (!catalogBatchId || typeof catalogBatchId !== "string") {
    throw new Error("catalogBatchId is required");
  }

  return getMembershipDelegate().deleteMany({
    where: {
      shop,
      catalogBatchId,
    },
  });
};
