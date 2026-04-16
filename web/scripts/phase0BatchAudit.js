import "dotenv/config";
import pg from "pg";
import { normalizePostgresConnectionString } from "../utils/postgresSslUtils.js";

const { Client } = pg;

const serialize = (value) =>
  JSON.stringify(
    value,
    (_key, entry) => (typeof entry === "bigint" ? entry.toString() : entry),
    2,
  );

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const client = new Client({
    connectionString: normalizePostgresConnectionString(process.env.DATABASE_URL),
  });

  await client.connect();

  try {
    const query = async (text) => {
      const result = await client.query(text);
      return result.rows;
    };

    const storeActiveMirrorBatches = await query(`
      SELECT "shopUrl" AS shop,
             array_remove(array_agg(DISTINCT "activeMirrorBatchId"), NULL) AS "activeMirrorBatchIds"
      FROM "Store"
      GROUP BY "shopUrl"
      ORDER BY "shopUrl"
    `);
  const catalogSnapshotBatches = await query(`
      SELECT shop,
             array_remove(array_agg(DISTINCT "catalogBatchId"), NULL) AS "catalogBatchIds"
      FROM "CatalogSnapshot"
      GROUP BY shop
      ORDER BY shop
    `);
  const activeCatalogSnapshotBatches = await query(`
      SELECT shop,
             array_remove(array_agg(DISTINCT "catalogBatchId"), NULL) AS "activeCatalogBatchIds"
      FROM "CatalogSnapshot"
      WHERE status = 'ACTIVE'
      GROUP BY shop
      ORDER BY shop
    `);
  const productCounts = await query(`
      SELECT shop, "mirrorBatchId", COUNT(*)::bigint AS count
      FROM "Product"
      GROUP BY shop, "mirrorBatchId"
      ORDER BY shop, "mirrorBatchId"
    `);
  const variantCounts = await query(`
      SELECT shop, "mirrorBatchId", COUNT(*)::bigint AS count
      FROM "Variant"
      GROUP BY shop, "mirrorBatchId"
      ORDER BY shop, "mirrorBatchId"
    `);
  const membershipCounts = await query(`
      SELECT shop, "catalogBatchId", COUNT(*)::bigint AS count
      FROM "ProductCollectionMembership"
      GROUP BY shop, "catalogBatchId"
      ORDER BY shop, "catalogBatchId"
    `);
  const inventoryCounts = await query(`
      SELECT shop, "catalogBatchId", COUNT(*)::bigint AS count
      FROM "VariantInventoryLevel"
      GROUP BY shop, "catalogBatchId"
      ORDER BY shop, "catalogBatchId"
    `);

  console.log(
    serialize({
      generatedAt: new Date().toISOString(),
      checklist: {
        storeActiveMirrorBatches,
        catalogSnapshotBatches,
        activeCatalogSnapshotBatches,
        productCounts,
        variantCounts,
        membershipCounts,
        inventoryCounts,
      },
    }),
  );
  } finally {
    await client.end();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
