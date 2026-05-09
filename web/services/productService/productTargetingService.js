import { prisma } from "../../config/database.js";
import { Prisma } from "../../generated/prisma/index.js";
import crypto from "crypto";
import {
  buildPrismaSortQuery,
  getProductPrismaWhere,
} from "./productFilterCompiler.js";
import { recordMirrorAnomaly } from "../mirrorAnomalyService.js";
import { getStoreMirrorState } from "../mirrorHealthService.js";

function codedError(code, message = code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

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
    throw codedError("SHOP_REQUIRED_FOR_PRODUCT_TARGETING");
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

function inferFilterDomains(filterParams = []) {
  const variantFields = new Set([
    "sku",
    "barcode",
    "variant_title",
    "price",
    "compare_at_price",
    "variant_inventory_q",
    "charge_tax",
    "cost",
    "country_of_origin",
    "hs_tariff_code",
    "inventory_policy",
    "inventory_out_of_stock_policy",
    "option_value_1",
    "option_value_2",
    "option_value_3",
    "physical_product",
    "track_quantity",
    "profit_margin",
    "weight",
    "weight_unit",
  ]);

  const collectionFields = new Set(["collection"]);
  const domains = new Set(["product"]);

  for (const filter of Array.isArray(filterParams) ? filterParams : []) {
    const field = String(filter?.field || "").trim();
    if (!field) continue;
    if (variantFields.has(field)) domains.add("variant");
    if (collectionFields.has(field)) domains.add("collection");
  }

  return domains;
}

async function validateMirrorBatchOwnership(
  { shop, mirrorBatchId },
  db = prisma
) {
  const safeShop = assertShop(shop);
  const safeMirrorBatchId =
    typeof mirrorBatchId === "string" ? mirrorBatchId.trim() : "";

  if (!safeMirrorBatchId) {
    throw codedError("MIRROR_BATCH_ID_REQUIRED");
  }

  const client = getClient(db);
  const store = await getStoreMirrorState(safeShop, client);

  if (!store) {
    throw codedError("STORE_NOT_FOUND");
  }

  if (store.activeMirrorBatchId === safeMirrorBatchId) {
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
    throw codedError("MIRROR_BATCH_SHOP_MISMATCH");
  }

  throw codedError("MIRROR_BATCH_NOT_ACTIVE_OR_MISMATCH");
}

async function assertFilterDomainsReady({
  shop,
  mirrorBatchId,
  filterParams,
}, db = prisma) {
  const state = await getClient(db).storeOperationalState.findUnique({
    where: { shop },
    select: {
      activeProductBatchId: true,
      activeVariantBatchId: true,
      activeCollectionBatchId: true,
    },
  });

  if (!state) {
    throw codedError("MIRROR_NOT_READY");
  }

  const domains = inferFilterDomains(filterParams);
  const notReady = [];

  const productReady = state.activeProductBatchId === mirrorBatchId;
  const variantReady = state.activeVariantBatchId === mirrorBatchId;
  const collectionReady = Boolean(state.activeCollectionBatchId);

  if (!productReady) notReady.push("product");
  if (domains.has("variant") && !variantReady) notReady.push("variant");
  if (domains.has("collection") && !collectionReady) notReady.push("collection");

  if (notReady.length > 0) {
    throw codedError(
      "MIRROR_DOMAIN_NOT_READY",
      `Mirror domain not ready: ${notReady.join(", ")}`,
    );
  }
}

export async function getActiveMirrorBatchId(shop, db = prisma) {
  const safeShop = assertShop(shop);
  const store = await getStoreMirrorState(safeShop, getClient(db));
  if (!store) {
    throw codedError("STORE_NOT_FOUND");
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
  allowExplicitTargeting = false,
  sampleLimit = 20,
  cursorId = null,
  mirrorBatchId: requestedMirrorBatchId = null,
  freeze = false,
  ownerType = null,
  ownerId = null,
  db = null,
}) {
  const safeShop = assertShop(shop);
  if (explicitWhere !== null) {
    throw codedError("EXPLICIT_WHERE_NOT_ALLOWED");
  }
  if (allowExplicitTargeting !== true && Array.isArray(explicitProductIds) && explicitProductIds.length > 0) {
    throw codedError("EXPLICIT_TARGETING_NOT_ALLOWED");
  }

  const safeProductIds = normalizeProductIds(explicitProductIds);
  const safeFilterParams = Array.isArray(filterParams) ? filterParams : [];
  if (safeProductIds.length > 0 && safeFilterParams.length > 0) {
    throw codedError("CANNOT_COMBINE_PRODUCT_IDS_WITH_FILTERS");
  }
  if (!safeFilterParams.length && !safeProductIds.length) {
    throw codedError("TARGET_FILTER_REQUIRED");
  }

  const page = normalizePositiveInt(queryParams.page, 1);
  const limit = normalizePositiveInt(queryParams.limit, sampleLimit);
  if (page > 1) {
    throw codedError("OFFSET_PAGINATION_NOT_SUPPORTED_USE_CURSOR");
  }

  if (cursorId && page > 1) {
    throw codedError("CURSOR_AND_PAGE_PAGINATION_CONFLICT");
  }

  const run = async (tx) => {
    const mirrorBatchId =
      typeof requestedMirrorBatchId === "string"
        ? requestedMirrorBatchId.trim()
        : "";

    if (!mirrorBatchId) {
      throw codedError(
        "MIRROR_BATCH_ID_REQUIRED_FOR_DETERMINISTIC_TARGETING",
      );
    }

    await validateMirrorBatchOwnership({ shop: safeShop, mirrorBatchId }, tx);
    await assertFilterDomainsReady({
      shop: safeShop,
      mirrorBatchId,
      filterParams: safeFilterParams,
    }, tx);

    const baseWhere = getProductPrismaWhere(safeFilterParams, safeShop);
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
  };

  if (db && db !== prisma) {
    return run(getClient(db));
  }

  return prisma.$transaction(run, TARGET_TRANSACTION_OPTIONS);
}

async function freezeTargetSnapshotInTransaction(
  {
    ownerType,
    ownerId,
    shop,
    where,
    mirrorBatchId,
    plannerFingerprint = null,
    plannerVersion = null,
    canonicalQueryHash = null,
    canonicalOrderBy = null,
  },
  db
) {
  const safeShop = assertShop(shop);
  if (!ownerType || !ownerId) {
    throw codedError("TARGET_OWNER_REQUIRED");
  }

  if (!mirrorBatchId) {
    throw codedError("MIRROR_BATCH_ID_REQUIRED");
  }

  const client = getClient(db);
  const scopedWhere = mergeWithMirrorBatch(where, safeShop, mirrorBatchId);

  const existingCount = await client.targetSnapshot.count({
    where: { ownerType, ownerId, shop: safeShop },
  });

  if (existingCount > 0) {
    const mismatch = await client.targetSnapshot.findFirst({
      where: {
        ownerType,
        ownerId,
        shop: safeShop,
        mirrorBatchId: {
          not: mirrorBatchId,
        },
      },
      select: { id: true },
    });

    if (!mismatch) {
      return existingCount;
    }
  }

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
        plannerFingerprint,
        plannerVersion,
        canonicalQueryHash,
        canonicalOrderBy,
      })),
      skipDuplicates: true,
    });

    totalInserted += products.length;
    cursorId = products[products.length - 1].id;
  }

  return totalInserted;
}

export async function freezeTargetSnapshot(args, db = null) {
  if (db) {
    return freezeTargetSnapshotInTransaction(args, db);
  }

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
    throw codedError("TARGET_OWNER_REQUIRED");
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
    throw codedError("TARGET_OWNER_REQUIRED");
  }

  const client = getClient(db);
  const [count, firstRow] = await Promise.all([
    client.targetSnapshot.count({
      where: { ownerType, ownerId, shop: safeShop },
    }),
    client.targetSnapshot.findFirst({
      where: { ownerType, ownerId, shop: safeShop },
      orderBy: { ordinal: "asc" },
      select: {
        mirrorBatchId: true,
        plannerFingerprint: true,
        plannerVersion: true,
        canonicalQueryHash: true,
        canonicalOrderBy: true,
      },
    }),
  ]);

  if (!count) {
    throw codedError("TARGET_SNAPSHOT_EMPTY");
  }

  if (firstRow?.mirrorBatchId) {
    const mismatched = await client.targetSnapshot.findFirst({
      where: {
        ownerType,
        ownerId,
        shop: safeShop,
        mirrorBatchId: {
          not: firstRow.mirrorBatchId,
        },
      },
      select: { id: true },
    });

    if (mismatched) {
      throw codedError(
        "TARGET_SNAPSHOT_MIRROR_BATCH_MISMATCH",
        "Frozen target snapshot spans multiple mirror batches",
      );
    }
  }

  return {
    count,
    mirrorBatchId: firstRow?.mirrorBatchId || null,
    plannerFingerprint: firstRow?.plannerFingerprint || null,
    plannerVersion: firstRow?.plannerVersion ?? null,
    canonicalQueryHash: firstRow?.canonicalQueryHash || null,
    canonicalOrderBy: firstRow?.canonicalOrderBy || null,
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
    throw codedError("SOURCE_AND_TARGET_OWNERS_REQUIRED");
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
      select: {
        productId: true,
        ordinal: true,
        mirrorBatchId: true,
        plannerFingerprint: true,
        plannerVersion: true,
        canonicalQueryHash: true,
        canonicalOrderBy: true,
      },
    });

    if (!rows.length) {
      break;
    }

    const baseOrdinal = totalInserted;
    await client.targetSnapshot.createMany({
      data: rows.map((row, index) => ({
        id: crypto.randomUUID(),
        ownerType: targetOwnerType,
        ownerId: targetOwnerId,
        shop: safeShop,
        productId: row.productId,
        ordinal: baseOrdinal + index + 1,
        mirrorBatchId: row.mirrorBatchId,
        plannerFingerprint: row.plannerFingerprint || null,
        plannerVersion: row.plannerVersion ?? null,
        canonicalQueryHash: row.canonicalQueryHash || null,
        canonicalOrderBy: row.canonicalOrderBy || null,
        updatedAt: new Date(),
      })),
      skipDuplicates: true,
    });

    totalInserted += rows.length;
    mirrorBatchId = mirrorBatchId || rows[0]?.mirrorBatchId || null;
    cursorOrdinal = rows[rows.length - 1].ordinal;
  }

  if (!totalInserted) {
    throw codedError("TARGET_SNAPSHOT_EMPTY");
  }

  return {
    count: totalInserted,
    mirrorBatchId,
  };
}

export async function cloneFrozenTargetSnapshot(args, db = null) {
  if (db) {
    return cloneFrozenTargetSnapshotInTransaction(args, db);
  }

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
