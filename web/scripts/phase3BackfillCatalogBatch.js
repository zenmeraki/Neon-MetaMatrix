import "dotenv/config";
import pg from "pg";
import { normalizePostgresConnectionString } from "../utils/postgresSslUtils.js";

const { Client } = pg;

const DEFAULT_BATCH_SIZE = 5000;
const MAX_BATCH_SIZE = 50000;

const serialize = (value) =>
  JSON.stringify(
    value,
    (_key, entry) => (typeof entry === "bigint" ? entry.toString() : entry),
    2,
  );

const readArgValue = (name) => {
  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));

  if (match) {
    return match.slice(prefix.length);
  }

  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

const hasFlag = (name) => process.argv.includes(name);

const parseBatchSize = () => {
  const value = readArgValue("--batch-size");
  const parsed = Number(value || DEFAULT_BATCH_SIZE);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("--batch-size must be a positive integer");
  }

  return Math.min(parsed, MAX_BATCH_SIZE);
};

const REQUIRED_COLUMNS = {
  Store: ["shopUrl", "activeMirrorBatchId"],
  Product: ["shop", "mirrorBatchId", "catalogBatchId"],
  Variant: [
    "shop",
    "mirrorBatchId",
    "catalogBatchId",
    "price",
    "priceDecimal",
    "compareAtPrice",
    "compareAtPriceDecimal",
    "cost",
    "costDecimal",
    "weight",
    "weightDecimal",
    "profitMargin",
    "profitMarginDecimal",
  ],
  ProductCollectionMembership: ["shop", "catalogBatchId"],
  VariantInventoryLevel: ["shop", "catalogBatchId"],
  ActiveCatalogSnapshot: [
    "shop",
    "catalogBatchId",
    "snapshotId",
    "isConsistent",
    "reason",
    "createdAt",
    "updatedAt",
  ],
};

const assertSchemaReady = async (client) => {
  const result = await client.query(
    `
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `,
    [Object.keys(REQUIRED_COLUMNS)],
  );
  const columnsByTable = new Map();

  for (const row of result.rows) {
    const columns = columnsByTable.get(row.table_name) || new Set();
    columns.add(row.column_name);
    columnsByTable.set(row.table_name, columns);
  }

  const missing = [];

  for (const [tableName, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const presentColumns = columnsByTable.get(tableName) || new Set();

    for (const columnName of columns) {
      if (!presentColumns.has(columnName)) {
        missing.push(`${tableName}.${columnName}`);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Phase 3 backfill requires Phase 1 additive schema first. Missing columns: ${missing.join(", ")}`,
    );
  }
};

const updateProductCatalogBatch = async (client, shop, batchSize) => {
  const result = await client.query(
    `
      WITH target AS (
        SELECT ctid
        FROM "Product"
        WHERE "shop" = $1
          AND "catalogBatchId" IS NULL
          AND "mirrorBatchId" IS NOT NULL
        LIMIT $2
      )
      UPDATE "Product" AS product
      SET "catalogBatchId" = product."mirrorBatchId"
      FROM target
      WHERE product.ctid = target.ctid
    `,
    [shop, batchSize],
  );

  return result.rowCount;
};

const updateVariantCatalogBatch = async (client, shop, batchSize) => {
  const result = await client.query(
    `
      WITH target AS (
        SELECT ctid
        FROM "Variant"
        WHERE "shop" = $1
          AND "catalogBatchId" IS NULL
          AND "mirrorBatchId" IS NOT NULL
        LIMIT $2
      )
      UPDATE "Variant" AS variant
      SET "catalogBatchId" = variant."mirrorBatchId"
      FROM target
      WHERE variant.ctid = target.ctid
    `,
    [shop, batchSize],
  );

  return result.rowCount;
};

const updateVariantDecimalShadows = async (client, shop, batchSize) => {
  const result = await client.query(
    `
      WITH target AS (
        SELECT ctid
        FROM "Variant"
        WHERE "shop" = $1
          AND (
            ("priceDecimal" IS NULL AND "price" IS NOT NULL)
            OR ("compareAtPriceDecimal" IS NULL AND "compareAtPrice" IS NOT NULL)
            OR ("costDecimal" IS NULL AND "cost" IS NOT NULL)
            OR ("weightDecimal" IS NULL AND "weight" IS NOT NULL)
            OR ("profitMarginDecimal" IS NULL AND "profitMargin" IS NOT NULL)
          )
        LIMIT $2
      )
      UPDATE "Variant" AS variant
      SET
        "priceDecimal" =
          CASE
            WHEN variant."price" IS NULL THEN NULL
            ELSE variant."price"::DECIMAL(18,6)
          END,
        "compareAtPriceDecimal" =
          CASE
            WHEN variant."compareAtPrice" IS NULL THEN NULL
            ELSE variant."compareAtPrice"::DECIMAL(18,6)
          END,
        "costDecimal" =
          CASE
            WHEN variant."cost" IS NULL THEN NULL
            ELSE variant."cost"::DECIMAL(18,6)
          END,
        "weightDecimal" =
          CASE
            WHEN variant."weight" IS NULL THEN NULL
            ELSE variant."weight"::DECIMAL(18,6)
          END,
        "profitMarginDecimal" =
          CASE
            WHEN variant."profitMargin" IS NULL THEN NULL
            ELSE variant."profitMargin"::DECIMAL(9,4)
          END
      FROM target
      WHERE variant.ctid = target.ctid
    `,
    [shop, batchSize],
  );

  return result.rowCount;
};

const getPendingShops = async (client) => {
  const result = await client.query(`
    SELECT shop
    FROM (
      SELECT DISTINCT "shop"
      FROM "Product"
      WHERE "catalogBatchId" IS NULL
        AND "mirrorBatchId" IS NOT NULL
      UNION
      SELECT DISTINCT "shop"
      FROM "Variant"
      WHERE "catalogBatchId" IS NULL
        AND "mirrorBatchId" IS NOT NULL
      UNION
      SELECT DISTINCT "shop"
      FROM "Variant"
      WHERE ("priceDecimal" IS NULL AND "price" IS NOT NULL)
         OR ("compareAtPriceDecimal" IS NULL AND "compareAtPrice" IS NOT NULL)
         OR ("costDecimal" IS NULL AND "cost" IS NOT NULL)
         OR ("weightDecimal" IS NULL AND "weight" IS NOT NULL)
         OR ("profitMarginDecimal" IS NULL AND "profitMargin" IS NOT NULL)
      UNION
      SELECT "shopUrl" AS shop
      FROM "Store"
      WHERE "activeMirrorBatchId" IS NOT NULL
      UNION
      SELECT "shop"
      FROM "ActiveCatalogSnapshot"
    ) AS pending
    ORDER BY shop
  `);

  return result.rows.map((row) => row.shop);
};

const getPendingCounts = async (client, shop) => {
  const result = await client.query(
    `
      SELECT
        (
          SELECT COUNT(*)::bigint
          FROM "Product"
          WHERE "shop" = $1
            AND "catalogBatchId" IS NULL
            AND "mirrorBatchId" IS NOT NULL
        ) AS "productCatalogBatchId",
        (
          SELECT COUNT(*)::bigint
          FROM "Variant"
          WHERE "shop" = $1
            AND "catalogBatchId" IS NULL
            AND "mirrorBatchId" IS NOT NULL
        ) AS "variantCatalogBatchId",
        (
          SELECT COUNT(*)::bigint
          FROM "Variant"
          WHERE "shop" = $1
            AND (
              ("priceDecimal" IS NULL AND "price" IS NOT NULL)
              OR ("compareAtPriceDecimal" IS NULL AND "compareAtPrice" IS NOT NULL)
              OR ("costDecimal" IS NULL AND "cost" IS NOT NULL)
              OR ("weightDecimal" IS NULL AND "weight" IS NOT NULL)
              OR ("profitMarginDecimal" IS NULL AND "profitMargin" IS NOT NULL)
            )
        ) AS "variantDecimalShadows"
    `,
    [shop],
  );

  return result.rows[0];
};

const seedActiveCatalogSnapshot = async (client, shop) => {
  const result = await client.query(
    `
      INSERT INTO "ActiveCatalogSnapshot" (
        "shop",
        "catalogBatchId",
        "isConsistent",
        "reason",
        "createdAt",
        "updatedAt"
      )
      SELECT
        store."shopUrl" AS "shop",
        store."activeMirrorBatchId" AS "catalogBatchId",
        TRUE AS "isConsistent",
        'seeded_from_store_activeMirrorBatchId' AS "reason",
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM "Store" AS store
      WHERE store."shopUrl" = $1
        AND store."activeMirrorBatchId" IS NOT NULL
      ON CONFLICT ("shop") DO NOTHING
    `,
    [shop],
  );

  return result.rowCount;
};

const getActiveCatalogSnapshotValidation = async (
  client,
  shop,
  { useStoreFallback = false } = {},
) => {
  const result = await client.query(
    `
      SELECT
        store."activeMirrorBatchId" AS "storeActiveMirrorBatchId",
        active."catalogBatchId" AS "storedActiveCatalogBatchId",
        CASE
          WHEN $2 THEN COALESCE(active."catalogBatchId", store."activeMirrorBatchId")
          ELSE active."catalogBatchId"
        END AS "activeCatalogBatchId",
        COALESCE(product_counts.count, 0)::bigint AS "productCount",
        COALESCE(variant_counts.count, 0)::bigint AS "variantCount",
        COALESCE(membership_counts.count, 0)::bigint AS "collectionMembershipCount",
        COALESCE(inventory_counts.count, 0)::bigint AS "inventoryLevelCount"
      FROM "Store" AS store
      LEFT JOIN "ActiveCatalogSnapshot" AS active
        ON active."shop" = store."shopUrl"
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS count
        FROM "Product"
        WHERE "shop" = store."shopUrl"
          AND "catalogBatchId" = CASE
            WHEN $2 THEN COALESCE(active."catalogBatchId", store."activeMirrorBatchId")
            ELSE active."catalogBatchId"
          END
      ) AS product_counts ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS count
        FROM "Variant"
        WHERE "shop" = store."shopUrl"
          AND "catalogBatchId" = CASE
            WHEN $2 THEN COALESCE(active."catalogBatchId", store."activeMirrorBatchId")
            ELSE active."catalogBatchId"
          END
      ) AS variant_counts ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS count
        FROM "ProductCollectionMembership"
        WHERE "shop" = store."shopUrl"
          AND "catalogBatchId" = CASE
            WHEN $2 THEN COALESCE(active."catalogBatchId", store."activeMirrorBatchId")
            ELSE active."catalogBatchId"
          END
      ) AS membership_counts ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS count
        FROM "VariantInventoryLevel"
        WHERE "shop" = store."shopUrl"
          AND "catalogBatchId" = CASE
            WHEN $2 THEN COALESCE(active."catalogBatchId", store."activeMirrorBatchId")
            ELSE active."catalogBatchId"
          END
      ) AS inventory_counts ON TRUE
      WHERE store."shopUrl" = $1
    `,
    [shop, useStoreFallback],
  );

  const row = result.rows[0] || null;

  if (!row?.activeCatalogBatchId) {
    return {
      shop,
      activeCatalogBatchId: null,
      storeActiveMirrorBatchId: row?.storeActiveMirrorBatchId || null,
      isConsistent: false,
      reason: useStoreFallback
        ? "active_catalog_snapshot_missing_and_store_activeMirrorBatchId_unavailable"
        : "active_catalog_snapshot_missing",
      counts: {
        productCount: 0,
        variantCount: 0,
        collectionMembershipCount: 0,
        inventoryLevelCount: 0,
      },
    };
  }

  const counts = {
    productCount: Number(row.productCount),
    variantCount: Number(row.variantCount),
    collectionMembershipCount: Number(row.collectionMembershipCount),
    inventoryLevelCount: Number(row.inventoryLevelCount),
  };
  const missingDomains = [];

  if (row.storeActiveMirrorBatchId !== row.activeCatalogBatchId) {
    missingDomains.push("store_active_mirror_batch_mismatch");
  }

  if (counts.productCount <= 0) {
    missingDomains.push("products");
  }

  if (counts.variantCount <= 0) {
    missingDomains.push("variants");
  }

  if (counts.collectionMembershipCount <= 0) {
    missingDomains.push("collection_memberships");
  }

  if (counts.inventoryLevelCount <= 0) {
    missingDomains.push("inventory_levels");
  }

  return {
    shop,
    activeCatalogBatchId: row.activeCatalogBatchId,
    storeActiveMirrorBatchId: row.storeActiveMirrorBatchId || null,
    isConsistent: missingDomains.length === 0,
    reason:
      missingDomains.length === 0
        ? "seeded_from_store_activeMirrorBatchId_validated"
        : `inconsistent_seed_missing_${missingDomains.join("_")}`,
    counts,
  };
};

const validateActiveCatalogSnapshot = async ({ client, shop, dryRun }) => {
  const validation = await getActiveCatalogSnapshotValidation(client, shop, {
    useStoreFallback: dryRun,
  });

  if (dryRun || !validation.activeCatalogBatchId) {
    return {
      ...validation,
      updated: false,
    };
  }

  await client.query(
    `
      UPDATE "ActiveCatalogSnapshot"
      SET
        "isConsistent" = $2,
        "reason" = $3,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "shop" = $1
    `,
    [shop, validation.isConsistent, validation.reason],
  );

  return {
    ...validation,
    updated: true,
  };
};

const runStepUntilComplete = async ({ client, shop, batchSize, runStep }) => {
  let total = 0;

  while (true) {
    const updated = await runStep(client, shop, batchSize);
    total += updated;

    if (updated < batchSize) {
      return total;
    }
  }
};

const runShopBackfill = async ({ client, shop, batchSize, dryRun }) => {
  const before = await getPendingCounts(client, shop);

  if (dryRun) {
    const activeSnapshotValidation = await validateActiveCatalogSnapshot({
      client,
      shop,
      dryRun,
    });

    return {
      shop,
      dryRun: true,
      activeSnapshotSeeded: 0,
      before,
      updated: {
        productCatalogBatchId: 0,
        variantCatalogBatchId: 0,
        variantDecimalShadows: 0,
      },
      activeSnapshotValidation,
      after: before,
    };
  }

  const productCatalogBatchId = await runStepUntilComplete({
    client,
    shop,
    batchSize,
    runStep: updateProductCatalogBatch,
  });
  const variantCatalogBatchId = await runStepUntilComplete({
    client,
    shop,
    batchSize,
    runStep: updateVariantCatalogBatch,
  });
  const variantDecimalShadows = await runStepUntilComplete({
    client,
    shop,
    batchSize,
    runStep: updateVariantDecimalShadows,
  });
  const activeSnapshotSeeded = await seedActiveCatalogSnapshot(client, shop);
  const activeSnapshotValidation = await validateActiveCatalogSnapshot({
    client,
    shop,
    dryRun,
  });
  const after = await getPendingCounts(client, shop);

  return {
    shop,
    dryRun: false,
    activeSnapshotSeeded,
    before,
    updated: {
      productCatalogBatchId,
      variantCatalogBatchId,
      variantDecimalShadows,
    },
    activeSnapshotValidation,
    after,
  };
};

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const shop = readArgValue("--shop");
  const batchSize = parseBatchSize();
  const dryRun = hasFlag("--dry-run");
  const client = new Client({
    connectionString: normalizePostgresConnectionString(process.env.DATABASE_URL),
  });

  await client.connect();

  try {
    await assertSchemaReady(client);

    const shops = shop ? [shop] : await getPendingShops(client);
    const results = [];

    for (const currentShop of shops) {
      results.push(
        await runShopBackfill({
          client,
          shop: currentShop,
          batchSize,
          dryRun,
        }),
      );
    }

    console.log(
      serialize({
        generatedAt: new Date().toISOString(),
        batchSize,
        shop: shop || null,
        dryRun,
        shopCount: shops.length,
        results,
      }),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
