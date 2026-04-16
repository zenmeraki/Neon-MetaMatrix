import { prisma } from "../Config/database.js";

/**
 * Inventory level repository.
 *
 * Transitional responsibilities:
 * - expose current variant-level inventory fields from Variant
 * - provide VariantInventoryLevel table methods for location-level inventory
 */

const VARIANT_INVENTORY_SELECT = {
  shop: true,
  id: true,
  productId: true,
  mirrorBatchId: true,
  sku: true,
  inventoryQuantity: true,
  inventoryPolicy: true,
  tracked: true,
};

const DEFAULT_LEVEL_SELECT = {
  id: true,
  shop: true,
  inventoryItemId: true,
  locationId: true,
  catalogBatchId: true,
  available: true,
  committed: true,
  incoming: true,
  onHand: true,
  sourceUpdatedAt: true,
  sourceEventAt: true,
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

const buildSelect = (select) => select || DEFAULT_LEVEL_SELECT;

const getInventoryLevelDelegate = () => {
  if (!prisma.variantInventoryLevel) {
    throw new Error(
      "Prisma model variantInventoryLevel is not available. Add the VariantInventoryLevel model and regenerate Prisma Client before using this repository.",
    );
  }

  return prisma.variantInventoryLevel;
};

/**
 * Current compatibility read from Variant inventory fields.
 */
export const listVariantInventoryByBatch = async ({
  shop,
  mirrorBatchId,
  tracked = null,
  take = 100,
}) => {
  assertShop(shop);
  assertBatchId(mirrorBatchId);

  const safeTake = typeof take === "number" && take > 0
    ? Math.min(take, 500)
    : 100;

  return prisma.variant.findMany({
    where: {
      shop,
      mirrorBatchId,
      ...(typeof tracked === "boolean" ? { tracked } : {}),
    },
    orderBy: [{ productId: "asc" }, { id: "asc" }],
    take: safeTake,
    select: VARIANT_INVENTORY_SELECT,
  });
};

export const createManyInventoryLevels = async (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("rows must be a non-empty array");
  }

  const delegate = getInventoryLevelDelegate();
  const result = await prisma.$transaction(async (tx) => {
    let count = 0;

    for (const row of rows) {
      assertShop(row?.shop);
      assertBatchId(row?.catalogBatchId);

      const where = {
        shop_catalogBatchId_inventoryItemId_locationId: {
          shop: row.shop,
          catalogBatchId: row.catalogBatchId,
          inventoryItemId: row.inventoryItemId,
          locationId: row.locationId,
        },
      };
      const existing = await tx.variantInventoryLevel.findUnique({
        where,
        select: {
          sourceUpdatedAt: true,
        },
      });

      if (
        existing?.sourceUpdatedAt &&
        row.sourceUpdatedAt &&
        existing.sourceUpdatedAt > row.sourceUpdatedAt
      ) {
        continue;
      }

      await tx.variantInventoryLevel.upsert({
        where,
        create: row,
        update: row,
      });
      count += 1;
    }

    return { count };
  });

  void delegate;
  return result;
};

export const listInventoryLevelsByBatch = async (
  { shop, catalogBatchId, locationId = null, inventoryItemId = null },
  options = {},
) => {
  assertShop(shop);
  assertBatchId(catalogBatchId);

  return getInventoryLevelDelegate().findMany({
    where: {
      shop,
      catalogBatchId,
      ...(locationId ? { locationId } : {}),
      ...(inventoryItemId ? { inventoryItemId } : {}),
    },
    orderBy: [{ locationId: "asc" }, { inventoryItemId: "asc" }],
    select: buildSelect(options.select),
  });
};

const INVENTORY_LOCATION_OPERATORS = new Set([
  ">",
  ">=",
  "<",
  "<=",
  "=",
  "!=",
  "greater than",
  "greater than or equal",
  "less than",
  "less than or equal",
  "equals",
  "is",
  "does not equal",
  "is not",
]);

/**
 * Returns distinct productIds whose variants have inventory at a specific
 * location satisfying the given quantity constraint.
 *
 * Uses VariantInventoryLevel as the authoritative source — never the
 * denormalized inventoryQuantity column on Variant.
 *
 * @param {object} params
 * @param {string} params.shop
 * @param {string} params.catalogBatchId
 * @param {string} params.locationId  - Shopify location GID
 * @param {string} [params.operator]  - quantity comparison operator
 * @param {number} [params.available] - quantity threshold (compared against available)
 * @param {number} [params.take]      - max productIds to return
 * @returns {Promise<string[]>} productIds
 */
export const findProductIdsByInventoryLocation = async ({
  shop,
  catalogBatchId,
  locationId,
  operator = "greater than",
  available = 0,
  take = 50000,
}) => {
  assertShop(shop);
  assertBatchId(catalogBatchId);

  if (!locationId || typeof locationId !== "string") {
    throw new Error("locationId is required");
  }

  if (!INVENTORY_LOCATION_OPERATORS.has(operator)) {
    throw new Error(`Unsupported inventory location operator: ${operator}`);
  }

  const qty = typeof available === "number" ? available : Number(available);

  if (!Number.isFinite(qty)) {
    throw new Error("available must be a finite number");
  }

  const safeTake = typeof take === "number" && take > 0
    ? Math.min(take, 50000)
    : 50000;

  const prismaOp = (() => {
    switch (operator) {
      case ">":
      case "greater than":
        return { gt: qty };
      case ">=":
      case "greater than or equal":
        return { gte: qty };
      case "<":
      case "less than":
        return { lt: qty };
      case "<=":
      case "less than or equal":
        return { lte: qty };
      case "=":
      case "equals":
      case "is":
        return { equals: qty };
      case "!=":
      case "does not equal":
      case "is not":
        return { not: qty };
      default:
        return { gt: qty };
    }
  })();

  const rows = await getInventoryLevelDelegate().findMany({
    where: {
      shop,
      catalogBatchId,
      locationId,
      available: prismaOp,
      productId: { not: null },
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

/**
 * Returns distinct locationIds present in the active catalog snapshot for a shop.
 * Used to populate inventory-location filter dropdowns.
 */
export const findDistinctLocationIdsByBatch = async ({
  shop,
  catalogBatchId,
  take = 200,
}) => {
  assertShop(shop);
  assertBatchId(catalogBatchId);

  const safeTake = typeof take === "number" && take > 0
    ? Math.min(take, 500)
    : 200;

  return getInventoryLevelDelegate().findMany({
    where: {
      shop,
      catalogBatchId,
    },
    select: {
      locationId: true,
    },
    distinct: ["locationId"],
    orderBy: [{ locationId: "asc" }],
    take: safeTake,
  });
};

export const deleteInventoryLevelsByBatch = async ({
  shop,
  catalogBatchId,
}) => {
  assertShop(shop);
  assertBatchId(catalogBatchId);

  return getInventoryLevelDelegate().deleteMany({
    where: {
      shop,
      catalogBatchId,
    },
  });
};
