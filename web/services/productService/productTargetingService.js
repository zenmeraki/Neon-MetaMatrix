import { prisma } from "../../config/database.js";
import { Prisma } from "../../generated/prisma/index.js";
import crypto from "crypto";
import {
  buildPrismaSortQuery,
  getProductPrismaWhere,
} from "./productFilterCompiler.js";
import { recordMirrorAnomaly } from "../mirrorAnomalyService.js";
import { getStoreMirrorState } from "../mirrorHealthService.js";

function mergeWithMirrorBatch(where, shop, mirrorBatchId) {
  const scoped = {
    AND: [where && typeof where === "object" ? where : {}, { shop }],
  };

  if (mirrorBatchId) {
    scoped.AND.push({ mirrorBatchId });
  }

  return scoped;
}

const TARGET_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  maxWait: 10_000,
  timeout: 300_000,
};

function getClient(db) {
  return db || prisma;
}

function assertShop(shop) {
  if (typeof shop !== "string" || !shop.trim()) {
    throw new Error("shop is required for product targeting");
  }

  return shop.trim();
}

function normalizePositiveInt(value, fallback, max = 1000) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function normalizeProductIds(productIds) {
  if (!Array.isArray(productIds)) return [];

  return [
    ...new Set(productIds.filter((id) => typeof id === "string" && id.trim())),
  ];
}

async function validateMirrorBatchOwnership(
  { shop, mirrorBatchId, requireActive = false },
  db = prisma
) {
  const safeShop = assertShop(shop);
  const safeMirrorBatchId =
    typeof mirrorBatchId === "string" ? mirrorBatchId.trim() : "";

  if (!safeMirrorBatchId) {
    throw new Error("mirrorBatchId is required for deterministic targeting");
  }

  const client = getClient(db);
  const store = await getStoreMirrorState(safeShop, client);

  if (!store) {
    throw new Error("Store not found");
  }

  if (requireActive && store.activeMirrorBatchId !== safeMirrorBatchId) {
    throw new Error(
      "Active mirror batch changed before target resolution completed"
    );
  }

  if (
    store.activeMirrorBatchId &&
    store.activeMirrorBatchId === safeMirrorBatchId
  ) {
    return store;
  }

  const batchRow = await client.product.findFirst({
    where: {
      shop: safeShop,
      mirrorBatchId: safeMirrorBatchId,
    },
    select: { id: true },
  });

  if (!batchRow) {
    throw new Error("Mirror batch does not belong to the requesting shop");
  }

  return store;
}

export async function getActiveMirrorBatchId(shop, db = prisma) {
  const safeShop = assertShop(shop);
  const store = await getStoreMirrorState(safeShop, getClient(db));
  if (!store) {
    throw new Error("Store not found");
  }

  return store.activeMirrorBatchId || null;
}

function buildTargetWhere({ baseWhere, shop, mirrorBatchId, productIds = [] }) {
  const where = mergeWithMirrorBatch(baseWhere, shop, mirrorBatchId);

  if (productIds.length > 0) {
    where.AND.push({
      id: {
        in: productIds,
      },
    });
  }

  return where;
}

export async function resolveCanonicalProductTarget({
  shop,
  filterParams = [],
  queryParams = {},
  explicitWhere = null,
  explicitProductIds = [],
  sampleLimit = 20,
  cursorId = null,
  mirrorBatchId: requestedMirrorBatchId = null,
  freeze = false,
  ownerType = null,
  ownerId = null,
}) {
  const safeShop = assertShop(shop);
  const safeProductIds = normalizeProductIds(explicitProductIds);
  const page = normalizePositiveInt(queryParams.page, 1);
  const limit = normalizePositiveInt(queryParams.limit, sampleLimit);
  const skip = (page - 1) * limit;

  if (cursorId && page > 1) {
    throw new Error("cursorId cannot be combined with page-based pagination");
  }

  return prisma.$transaction(async (tx) => {
    const pinnedMirrorBatchId =
      typeof requestedMirrorBatchId === "string"
        ? requestedMirrorBatchId.trim()
        : "";
    const mirrorBatchId =
      pinnedMirrorBatchId || (await getActiveMirrorBatchId(safeShop, tx));

    if (!mirrorBatchId) {
      throw new Error(
        "Active mirror batch is required for deterministic targeting"
      );
    }

    await validateMirrorBatchOwnership(
      {
        shop: safeShop,
        mirrorBatchId,
        requireActive: !pinnedMirrorBatchId,
      },
      tx
    );

    const baseWhere =
      explicitWhere || getProductPrismaWhere(filterParams, safeShop);
    const where = buildTargetWhere({
      baseWhere,
      shop: safeShop,
      mirrorBatchId,
      productIds: safeProductIds,
    });
    const orderBy = cursorId
      ? { id: "asc" }
      : buildPrismaSortQuery(queryParams.sortKey, queryParams.sortOrder);
    const pagedWhere = cursorId
      ? {
          AND: [where, { id: { gt: cursorId } }],
        }
      : where;

    const [count, sampleProducts] = await Promise.all([
      tx.product.count({ where }),
      tx.product.findMany({
        where: pagedWhere,
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
        ...(cursorId ? {} : { skip }),
        take: Math.min(limit, sampleLimit),
      }),
    ]);

    let frozenCount = null;
    if (freeze && ownerType && ownerId) {
      frozenCount = await freezeTargetSnapshotInTransaction(
        {
          ownerType,
          ownerId,
          shop: safeShop,
          where,
          mirrorBatchId,
        },
        tx
      );
    }

    return {
      mirrorBatchId,
      where,
      count,
      sampleProducts,
      frozenCount,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
        hasNextPage: skip + limit < count,
        hasPrevPage: page > 1,
      },
    };
  }, TARGET_TRANSACTION_OPTIONS);
}

async function freezeTargetSnapshotInTransaction(
  { ownerType, ownerId, shop, where, mirrorBatchId },
  db
) {
  const safeShop = assertShop(shop);
  if (!ownerType || !ownerId) {
    throw new Error("ownerType and ownerId are required to freeze targets");
  }

  if (!mirrorBatchId) {
    throw new Error("mirrorBatchId is required to freeze targets");
  }

  const client = getClient(db);
  const scopedWhere = mergeWithMirrorBatch(where, safeShop, mirrorBatchId);

  await client.targetSnapshot.deleteMany({
    where: { ownerType, ownerId, shop: safeShop },
  });

  const BATCH_SIZE = 1000;
  let cursorId = null;
  let totalInserted = 0;

  while (true) {
    const snapshotWhere = cursorId
      ? {
          AND: [scopedWhere, { id: { gt: cursorId } }],
        }
      : scopedWhere;

    const products = await client.product.findMany({
      where: snapshotWhere,
      select: { id: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });

    if (!products.length) {
      break;
    }

    await client.targetSnapshot.createMany({
      data: products.map((product, index) => ({
        ownerType,
        ownerId,
        shop: safeShop,
        productId: product.id,
        ordinal: totalInserted + index + 1,
        mirrorBatchId,
      })),
      skipDuplicates: true,
    });

    totalInserted += products.length;
    cursorId = products[products.length - 1].id;
  }

  return totalInserted;
}

export async function freezeTargetSnapshot(args) {
  return prisma.$transaction(
    (tx) => freezeTargetSnapshotInTransaction(args, tx),
    TARGET_TRANSACTION_OPTIONS
  );
}

export async function getFrozenTargetProductIds({
  ownerType,
  ownerId,
  shop,
  limit = 500,
  cursorOrdinal = 0,
}) {
  const safeShop = assertShop(shop);
  if (!ownerType || !ownerId) {
    throw new Error(
      "ownerType and ownerId are required to read frozen targets"
    );
  }

  const take = normalizePositiveInt(limit, 500, 1000);
  const rows = await prisma.targetSnapshot.findMany({
    where: {
      ownerType,
      ownerId,
      shop: safeShop,
      ordinal: {
        gt: Number(cursorOrdinal) || 0,
      },
    },
    orderBy: { ordinal: "asc" },
    take,
  });

  return {
    rows,
    lastProductId: rows.length ? rows[rows.length - 1].productId : null,
    lastOrdinal: rows.length
      ? rows[rows.length - 1].ordinal
      : Number(cursorOrdinal) || 0,
    hasMore: rows.length === take,
  };
}

async function getFrozenTargetSnapshotSummaryInTransaction(
  { ownerType, ownerId, shop },
  db
) {
  const safeShop = assertShop(shop);
  if (!ownerType || !ownerId) {
    throw new Error(
      "ownerType and ownerId are required to inspect frozen targets"
    );
  }

  const client = getClient(db);
  const [count, firstRow] = await Promise.all([
    client.targetSnapshot.count({
      where: { ownerType, ownerId, shop: safeShop },
    }),
    client.targetSnapshot.findFirst({
      where: { ownerType, ownerId, shop: safeShop },
      orderBy: { ordinal: "asc" },
      select: { mirrorBatchId: true },
    }),
  ]);

  if (!count) {
    throw new Error("Target snapshot not found or contains no products");
  }

  return {
    count,
    mirrorBatchId: firstRow?.mirrorBatchId || null,
  };
}

export async function getFrozenTargetSnapshotSummary(args) {
  return getFrozenTargetSnapshotSummaryInTransaction(args, prisma);
}

async function cloneFrozenTargetSnapshotInTransaction(
  { sourceOwnerType, sourceOwnerId, targetOwnerType, targetOwnerId, shop },
  db
) {
  const safeShop = assertShop(shop);
  if (
    !sourceOwnerType ||
    !sourceOwnerId ||
    !targetOwnerType ||
    !targetOwnerId
  ) {
    throw new Error("Source and target snapshot owners are required");
  }

  const client = getClient(db);
  await client.targetSnapshot.deleteMany({
    where: {
      ownerType: targetOwnerType,
      ownerId: targetOwnerId,
      shop: safeShop,
    },
  });

  const BATCH_SIZE = 1000;
  let cursorOrdinal = 0;
  let totalInserted = 0;
  let mirrorBatchId = null;

  while (true) {
    const rows = await client.targetSnapshot.findMany({
      where: {
        ownerType: sourceOwnerType,
        ownerId: sourceOwnerId,
        shop: safeShop,
        ordinal: {
          gt: cursorOrdinal,
        },
      },
      orderBy: { ordinal: "asc" },
      take: BATCH_SIZE,
    });

    if (!rows.length) {
      break;
    }

    await client.targetSnapshot.createMany({
      data: rows.map((row) => ({
        id: crypto.randomUUID(),
        ownerType: targetOwnerType,
        ownerId: targetOwnerId,
        shop: safeShop,
        productId: row.productId,
        ordinal: row.ordinal,
        mirrorBatchId: row.mirrorBatchId,
        updatedAt: new Date(),
      })),
      skipDuplicates: true,
    });

    totalInserted += rows.length;
    mirrorBatchId = mirrorBatchId || rows[0]?.mirrorBatchId || null;
    cursorOrdinal = rows[rows.length - 1].ordinal;
  }

  if (!totalInserted) {
    throw new Error("Target snapshot not found or contains no products");
  }

  return {
    count: totalInserted,
    mirrorBatchId,
  };
}

export async function cloneFrozenTargetSnapshot(args) {
  return prisma.$transaction(
    (tx) => cloneFrozenTargetSnapshotInTransaction(args, tx),
    TARGET_TRANSACTION_OPTIONS
  );
}

export async function markPreviewExecutionMismatch({
  shop,
  ownerType,
  ownerId,
  previewCount,
  frozenCount,
}) {
  const safeShop = assertShop(shop);

  await recordMirrorAnomaly({
    shop: safeShop,
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
