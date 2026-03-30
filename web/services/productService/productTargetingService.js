import { prisma } from "../../config/database.js";
import {
  buildPrismaSortQuery,
  getProductPrismaWhere,
} from "./productFilterCompiler.js";
import { recordMirrorAnomaly } from "../mirrorAnomalyService.js";
import { getStoreMirrorState } from "../mirrorHealthService.js";

function mergeWithMirrorBatch(where, shop, mirrorBatchId) {
  const scoped = {
    AND: [
      where && typeof where === "object" ? where : {},
      { shop },
    ],
  };

  if (mirrorBatchId) {
    scoped.AND.push({ mirrorBatchId });
  }

  return scoped;
}

export async function getActiveMirrorBatchId(shop) {
  const store = await getStoreMirrorState(shop);
  if (!store) {
    throw new Error("Store not found");
  }

  return store.activeMirrorBatchId || null;
}

export async function resolveCanonicalProductTarget({
  shop,
  filterParams = [],
  queryParams = {},
  explicitWhere = null,
  explicitProductIds = [],
  sampleLimit = 20,
  freeze = false,
  ownerType = null,
  ownerId = null,
}) {
  const mirrorBatchId = await getActiveMirrorBatchId(shop);
  const baseWhere = explicitWhere || getProductPrismaWhere(filterParams, shop);
  const where = mergeWithMirrorBatch(baseWhere, shop, mirrorBatchId);

  if (Array.isArray(explicitProductIds) && explicitProductIds.length > 0) {
    where.AND.push({
      id: {
        in: explicitProductIds,
      },
    });
  }

  const orderBy = buildPrismaSortQuery(queryParams.sortKey, queryParams.sortOrder);
  const page = Number.parseInt(queryParams.page, 10) || 1;
  const limit = Number.parseInt(queryParams.limit, 10) || sampleLimit;
  const skip = (page - 1) * limit;

  const [count, sampleProducts] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      select: {
        id: true,
        title: true,
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
      take: Math.min(limit, sampleLimit),
    }),
  ]);

  if (freeze && ownerType && ownerId) {
    await freezeTargetSnapshot({ ownerType, ownerId, shop, where, mirrorBatchId });
  }

  return {
    mirrorBatchId,
    where,
    count,
    sampleProducts,
    pagination: {
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
      hasNextPage: skip + limit < count,
      hasPrevPage: page > 1,
    },
  };
}

export async function freezeTargetSnapshot({
  ownerType,
  ownerId,
  shop,
  where,
  mirrorBatchId,
}) {
  await prisma.targetSnapshot.deleteMany({
    where: { ownerType, ownerId },
  });

  const BATCH_SIZE = 1000;
  let cursorId = null;
  let totalInserted = 0;

  while (true) {
    const snapshotWhere = {
      AND: [
        ...(Array.isArray(where?.AND) ? where.AND : [where]),
        ...(cursorId ? [{ id: { gt: cursorId } }] : []),
      ],
    };

    const products = await prisma.product.findMany({
      where: snapshotWhere,
      select: { id: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });

    if (!products.length) {
      break;
    }

    await prisma.targetSnapshot.createMany({
      data: products.map((product) => ({
        ownerType,
        ownerId,
        shop,
        productId: product.id,
        mirrorBatchId,
      })),
      skipDuplicates: true,
    });

    totalInserted += products.length;
    cursorId = products[products.length - 1].id;
  }

  return totalInserted;
}

export async function getFrozenTargetProductIds({
  ownerType,
  ownerId,
  shop,
  limit = 500,
  cursorId = null,
}) {
  const rows = await prisma.targetSnapshot.findMany({
    where: {
      ownerType,
      ownerId,
      shop,
      ...(cursorId ? { productId: { gt: cursorId } } : {}),
    },
    orderBy: { productId: "asc" },
    take: limit,
  });

  return {
    rows,
    lastProductId: rows.length ? rows[rows.length - 1].productId : null,
    hasMore: rows.length === limit,
  };
}

export async function markPreviewExecutionMismatch({
  shop,
  ownerType,
  ownerId,
  previewCount,
  frozenCount,
}) {
  await recordMirrorAnomaly({
    shop,
    severity: "high",
    type: "preview_execution_mismatch",
    entityType: ownerType,
    entityId: ownerId,
    message: `Preview count ${previewCount} differed from frozen execution count ${frozenCount}`,
    details: {
      previewCount,
      frozenCount,
    },
  });
}
