import "dotenv/config";
import pg from "pg";
import { normalizePostgresConnectionString } from "../utils/postgresSslUtils.js";

const { Client } = pg;

const REQUIRED_COLUMNS = {
  Product: ["shop", "id", "catalogBatchId"],
  Variant: ["shop", "id", "productId", "catalogBatchId"],
  ProductCollectionMembership: ["shop", "catalogBatchId"],
  VariantInventoryLevel: ["shop", "catalogBatchId"],
  ActiveCatalogSnapshot: ["shop", "catalogBatchId", "isConsistent", "reason"],
};

const REQUIRED_DOMAINS = [
  ["products", "has_products"],
  ["variants", "has_variants"],
  ["collections", "has_collections"],
  ["inventory", "has_inventory"],
];

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

const readAllArgValues = (name) =>
  process.argv
    .filter((arg) => arg.startsWith(`${name}=`))
    .map((arg) => arg.slice(name.length + 1));

const parseAllowMissingDomains = () => {
  const values = readAllArgValues("--allow-missing");
  const allowed = new Map();

  for (const value of values) {
    const [shop, domainList] = value.split(":");

    if (!shop || !domainList) {
      throw new Error(
        "--allow-missing must use shop:domain[,domain] format, for example --allow-missing=example.myshopify.com:collections,inventory",
      );
    }

    const domains = domainList
      .split(",")
      .map((domain) => domain.trim())
      .filter(Boolean);

    for (const domain of domains) {
      if (!REQUIRED_DOMAINS.some(([name]) => name === domain)) {
        throw new Error(
          `Unsupported missing-domain allowance "${domain}". Supported domains: ${REQUIRED_DOMAINS.map(([name]) => name).join(", ")}`,
        );
      }
    }

    allowed.set(shop, new Set([...(allowed.get(shop) || []), ...domains]));
  }

  return allowed;
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
      `Phase 4 validation requires Phase 1 additive schema first. Missing columns: ${missing.join(", ")}`,
    );
  }
};

const getProductCounts = async (client, shop) => {
  const result = await client.query(
    `
      SELECT p."shop", p."catalogBatchId", COUNT(*)::bigint AS product_count
      FROM "Product" p
      WHERE ($1::text IS NULL OR p."shop" = $1)
      GROUP BY p."shop", p."catalogBatchId"
      ORDER BY p."shop", p."catalogBatchId"
    `,
    [shop],
  );

  return result.rows;
};

const getVariantCounts = async (client, shop) => {
  const result = await client.query(
    `
      SELECT v."shop", v."catalogBatchId", COUNT(*)::bigint AS variant_count
      FROM "Variant" v
      WHERE ($1::text IS NULL OR v."shop" = $1)
      GROUP BY v."shop", v."catalogBatchId"
      ORDER BY v."shop", v."catalogBatchId"
    `,
    [shop],
  );

  return result.rows;
};

const getActiveOrphanVariants = async (client, shop) => {
  const result = await client.query(
    `
      SELECT v."shop", v."id", v."productId", v."catalogBatchId"
      FROM "Variant" v
      JOIN "ActiveCatalogSnapshot" a
        ON a."shop" = v."shop"
       AND a."catalogBatchId" = v."catalogBatchId"
      LEFT JOIN "Product" p
        ON p."shop" = v."shop"
       AND p."id" = v."productId"
       AND p."catalogBatchId" = v."catalogBatchId"
      WHERE v."catalogBatchId" IS NOT NULL
        AND p."id" IS NULL
        AND ($1::text IS NULL OR v."shop" = $1)
      ORDER BY v."shop", v."catalogBatchId", v."id"
      LIMIT 500
    `,
    [shop],
  );

  return result.rows;
};

const getCrossDomainActiveBatches = async (client, shop) => {
  const result = await client.query(
    `
      SELECT a."shop", a."catalogBatchId",
        EXISTS (
          SELECT 1 FROM "Product" p
          WHERE p."shop" = a."shop"
            AND p."catalogBatchId" = a."catalogBatchId"
        ) AS has_products,
        EXISTS (
          SELECT 1 FROM "Variant" v
          WHERE v."shop" = a."shop"
            AND v."catalogBatchId" = a."catalogBatchId"
        ) AS has_variants,
        EXISTS (
          SELECT 1 FROM "ProductCollectionMembership" pcm
          WHERE pcm."shop" = a."shop"
            AND pcm."catalogBatchId" = a."catalogBatchId"
        ) AS has_collections,
        EXISTS (
          SELECT 1 FROM "VariantInventoryLevel" vil
          WHERE vil."shop" = a."shop"
            AND vil."catalogBatchId" = a."catalogBatchId"
        ) AS has_inventory,
        a."isConsistent",
        a."reason"
      FROM "ActiveCatalogSnapshot" a
      WHERE ($1::text IS NULL OR a."shop" = $1)
      ORDER BY a."shop"
    `,
    [shop],
  );

  return result.rows;
};

const buildFailures = ({ orphanVariants, crossDomainActiveBatches, allowedMissingDomains }) => {
  const failures = [];

  if (orphanVariants.length > 0) {
    failures.push({
      gate: "active_orphan_variants",
      message: "Active batches must not have variants without a product in the same catalogBatchId",
      count: orphanVariants.length,
      sample: orphanVariants.slice(0, 20),
    });
  }

  for (const batch of crossDomainActiveBatches) {
    const allowedForShop = allowedMissingDomains.get(batch.shop) || new Set();
    const missingDomains = REQUIRED_DOMAINS
      .filter(([domain, field]) => !batch[field] && !allowedForShop.has(domain))
      .map(([domain]) => domain);

    if (missingDomains.length > 0) {
      failures.push({
        gate: "active_cross_domain_presence",
        shop: batch.shop,
        catalogBatchId: batch.catalogBatchId,
        missingDomains,
        message: "Active batch is missing required catalog domains",
      });
    }

    if (batch.isConsistent === false) {
      failures.push({
        gate: "active_snapshot_consistency_flag",
        shop: batch.shop,
        catalogBatchId: batch.catalogBatchId,
        reason: batch.reason,
        message: "ActiveCatalogSnapshot is already marked inconsistent",
      });
    }
  }

  return failures;
};

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const shop = readArgValue("--shop");
  const allowedMissingDomains = parseAllowMissingDomains();
  const client = new Client({
    connectionString: normalizePostgresConnectionString(process.env.DATABASE_URL),
  });

  await client.connect();

  try {
    await assertSchemaReady(client);

    const [
      productCounts,
      variantCounts,
      orphanVariants,
      crossDomainActiveBatches,
    ] = await Promise.all([
      getProductCounts(client, shop),
      getVariantCounts(client, shop),
      getActiveOrphanVariants(client, shop),
      getCrossDomainActiveBatches(client, shop),
    ]);
    const failures = buildFailures({
      orphanVariants,
      crossDomainActiveBatches,
      allowedMissingDomains,
    });

    console.log(
      serialize({
        generatedAt: new Date().toISOString(),
        shop: shop || null,
        allowedMissingDomains: Object.fromEntries(
          [...allowedMissingDomains.entries()].map(([allowedShop, domains]) => [
            allowedShop,
            [...domains],
          ]),
        ),
        gatesPassed: failures.length === 0,
        productCounts,
        variantCounts,
        orphanVariants,
        crossDomainActiveBatches,
        failures,
      }),
    );

    if (failures.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
