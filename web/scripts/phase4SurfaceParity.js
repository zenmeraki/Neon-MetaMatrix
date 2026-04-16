import "dotenv/config";
import fs from "node:fs";
import pg from "pg";
import { normalizePostgresConnectionString } from "../utils/postgresSslUtils.js";

const { Client } = pg;

const REQUIRED_COLUMNS = {
  Store: ["shopUrl", "activeMirrorBatchId"],
  Product: ["shop", "id", "mirrorBatchId", "catalogBatchId"],
  Variant: ["shop", "id", "productId", "mirrorBatchId", "catalogBatchId"],
  ProductCollectionMembership: ["shop", "catalogBatchId", "productId", "collectionTitle"],
  ActiveCatalogSnapshot: ["shop", "catalogBatchId", "isConsistent"],
};

const PRODUCT_STRING_FIELDS = {
  title: "title",
  vendor: "vendor",
  handle: "handle",
  description: "descriptionText",
  product_type: "productType",
  status: "status",
  product_id: "id",
  category: "categoryName",
  theme_template: "templateSuffix",
  option_name_1: "option1Name",
  option_name_2: "option2Name",
  option_name_3: "option3Name",
  googleShoppingAgeGroup: "googleShoppingAgeGroup",
  google_shopping_age_group: "googleShoppingAgeGroup",
  googleShoppingCategory: "googleShoppingCategory",
  google_shopping_category: "googleShoppingCategory",
  googleShoppingColor: "googleShoppingColor",
  google_shopping_color: "googleShoppingColor",
  googleShoppingCondition: "googleShoppingCondition",
  google_shopping_condition: "googleShoppingCondition",
  googleShoppingCustomLabel0: "googleShoppingCustomLabel0",
  google_shopping_custom_label_0: "googleShoppingCustomLabel0",
  googleShoppingCustomLabel1: "googleShoppingCustomLabel1",
  google_shopping_custom_label_1: "googleShoppingCustomLabel1",
  googleShoppingCustomLabel2: "googleShoppingCustomLabel2",
  google_shopping_custom_label_2: "googleShoppingCustomLabel2",
  googleShoppingCustomLabel3: "googleShoppingCustomLabel3",
  google_shopping_custom_label_3: "googleShoppingCustomLabel3",
  googleShoppingCustomLabel4: "googleShoppingCustomLabel4",
  google_shopping_custom_label_4: "googleShoppingCustomLabel4",
  googleShoppingGender: "googleShoppingGender",
  google_shopping_gender: "googleShoppingGender",
  googleShoppingMpn: "googleShoppingMpn",
  google_shopping_mpn: "googleShoppingMpn",
  googleShoppingMaterial: "googleShoppingMaterial",
  google_shopping_material: "googleShoppingMaterial",
  googleShoppingSize: "googleShoppingSize",
  google_shopping_size: "googleShoppingSize",
  googleShoppingSizeSystem: "googleShoppingSizeSystem",
  google_shopping_size_system: "googleShoppingSizeSystem",
  googleShoppingSizeType: "googleShoppingSizeType",
  google_shopping_size_type: "googleShoppingSizeType",
  categoryAgeGroup: "categoryAgeGroup",
  category_age_group: "categoryAgeGroup",
  categoryColor: "categoryColor",
  category_color: "categoryColor",
  categoryFabric: "categoryFabric",
  category_fabric: "categoryFabric",
  categoryFit: "categoryFit",
  category_fit: "categoryFit",
  categorySize: "categorySize",
  category_size: "categorySize",
  categoryTargetGender: "categoryTargetGender",
  category_target_gender: "categoryTargetGender",
  categoryWaistRise: "categoryWaistRise",
  category_waist_rise: "categoryWaistRise",
};

const PRODUCT_NUMBER_FIELDS = {
  inventory_q: "totalInventory",
  variant_count: "variantCount",
  vc: "variantCount",
};

const PRODUCT_DATE_FIELDS = {
  created_at: "createdAt",
  updated_at: "updatedAt",
  published_at: "publishedAt",
};

const PRODUCT_BOOLEAN_FIELDS = {
  visible_online_store: "visibleOnlineStore",
  googleShoppingEnabled: "googleShoppingEnabled",
  google_shopping_enabled: "googleShoppingEnabled",
  googleShoppingCustomProduct: "googleShoppingCustomProduct",
  google_shopping_custom_product: "googleShoppingCustomProduct",
};

const VARIANT_STRING_FIELDS = {
  sku: "sku",
  barcode: "barcode",
  variant_title: "title",
  country_of_origin: "countryOfOrigin",
  hs_tariff_code: "hsTariffCode",
  inventory_policy: "inventoryPolicy",
  inventory_out_of_stock_policy: "inventoryPolicy",
  option_value_1: "option1Value",
  option_value_2: "option2Value",
  option_value_3: "option3Value",
  weight_unit: "weightUnit",
};

const VARIANT_NUMBER_FIELDS = {
  price: "price",
  compare_at_price: "compareAtPrice",
  variant_inventory_q: "inventoryQuantity",
  cost: "cost",
  profit_margin: "profitMargin",
  weight: "weight",
};

const VARIANT_BOOLEAN_FIELDS = {
  charge_tax: "taxable",
  physical_product: "physicalProduct",
  track_quantity: "tracked",
};

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

const readJsonArg = (name, fallback) => {
  const value = readArgValue(name);
  return value ? JSON.parse(value) : fallback;
};

const readFilterParams = () => {
  const filterFile = readArgValue("--filter-file");

  if (filterFile) {
    return JSON.parse(fs.readFileSync(filterFile, "utf8"));
  }

  return readJsonArg("--filter-json", []);
};

const quoteIdent = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;

const makeSqlBuilder = () => {
  const values = [];

  return {
    values,
    param(value) {
      values.push(value);
      return `$${values.length}`;
    },
  };
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
      `Phase 4 surface parity requires Phase 1 additive schema first. Missing columns: ${missing.join(", ")}`,
    );
  }
};

const normalizeBoolean = (value) => {
  if (typeof value === "boolean") {
    return value;
  }

  return ["true", "1", "yes", "active"].includes(
    String(value).trim().toLowerCase(),
  );
};

const buildStringCondition = (alias, field, operator, value, builder) => {
  const column = `${alias}.${quoteIdent(field)}`;

  switch (operator) {
    case "equals":
    case "is":
      return `LOWER(${column}) = LOWER(${builder.param(String(value ?? ""))})`;
    case "does not equal":
    case "is not":
      return `(${column} IS NULL OR LOWER(${column}) <> LOWER(${builder.param(String(value ?? ""))}))`;
    case "contains":
      return `${column} ILIKE ${builder.param(`%${String(value ?? "")}%`)}`;
    case "does not contain":
      return `(${column} IS NULL OR ${column} NOT ILIKE ${builder.param(`%${String(value ?? "")}%`)})`;
    case "starts with":
      return `${column} ILIKE ${builder.param(`${String(value ?? "")}%`)}`;
    case "ends with":
      return `${column} ILIKE ${builder.param(`%${String(value ?? "")}`)}`;
    case "is empty":
    case "is empty/blank":
      return `(${column} IS NULL OR ${column} = '')`;
    case "is not empty":
      return `(${column} IS NOT NULL AND ${column} <> '')`;
    default:
      return "TRUE";
  }
};

const buildNumberCondition = (alias, field, operator, value, builder) => {
  const decimal = String(value ?? "").trim();
  const column = `${alias}.${quoteIdent(field)}`;

  if (!/^-?\d+(\.\d+)?$/.test(decimal)) {
    return "TRUE";
  }

  const param = builder.param(decimal);

  switch (operator) {
    case "<":
    case "less than":
      return `${column} < ${param}::numeric`;
    case "<=":
    case "less than or equal":
      return `${column} <= ${param}::numeric`;
    case ">":
    case "greater than":
      return `${column} > ${param}::numeric`;
    case ">=":
    case "greater than or equal":
      return `${column} >= ${param}::numeric`;
    case "=":
    case "equals":
    case "is":
      return `${column} = ${param}::numeric`;
    case "!=":
    case "does not equal":
    case "is not":
      return `(${column} IS NULL OR ${column} <> ${param}::numeric)`;
    case "is empty":
    case "is empty/blank":
      return `${column} IS NULL`;
    case "is not empty":
      return `${column} IS NOT NULL`;
    default:
      return "TRUE";
  }
};

const buildBooleanCondition = (alias, field, operator, value, builder) => {
  const column = `${alias}.${quoteIdent(field)}`;
  const param = builder.param(normalizeBoolean(value));

  switch (operator) {
    case "does not equal":
    case "is not":
    case "!=":
      return `(${column} IS NULL OR ${column} <> ${param}::boolean)`;
    case "is empty":
    case "is empty/blank":
      return `${column} IS NULL`;
    case "is not empty":
      return `${column} IS NOT NULL`;
    default:
      return `${column} = ${param}::boolean`;
  }
};

const buildDateCondition = (alias, field, operator, value, builder) => {
  const column = `${alias}.${quoteIdent(field)}`;

  switch (operator) {
    case "is before":
      return `${column} < ${builder.param(value)}::timestamp`;
    case "is after":
      return `${column} > ${builder.param(value)}::timestamp`;
    case "is on":
      return `(${column} >= ${builder.param(`${value}T00:00:00.000Z`)}::timestamp AND ${column} < ${builder.param(`${value}T23:59:59.999Z`)}::timestamp)`;
    case "is empty":
    case "is empty/blank":
      return `${column} IS NULL`;
    case "is not empty":
      return `${column} IS NOT NULL`;
    default:
      return "TRUE";
  }
};

const buildTagCondition = (operator, value, builder) => {
  const param = builder.param(value);

  switch (operator) {
    case "contains":
    case "equals":
    case "is":
      return `${param} = ANY(p."tags")`;
    case "does not contain":
    case "does not equal":
    case "is not":
      return `NOT (${param} = ANY(p."tags"))`;
    case "is empty":
    case "is empty/blank":
      return `COALESCE(array_length(p."tags", 1), 0) = 0`;
    case "is not empty":
      return `COALESCE(array_length(p."tags", 1), 0) > 0`;
    default:
      return "TRUE";
  }
};

const buildCollectionCondition = ({ batchId, operator, value, builder }) => {
  const batchParam = builder.param(batchId);
  const valueParam = builder.param(`%${String(value ?? "")}%`);
  const exactParam = builder.param(String(value ?? ""));
  const exists = (condition = "") => `
    EXISTS (
      SELECT 1
      FROM "ProductCollectionMembership" pcm
      WHERE pcm."shop" = p."shop"
        AND pcm."productId" = p."id"
        AND pcm."catalogBatchId" = ${batchParam}
        ${condition}
    )
  `;

  switch (operator) {
    case "equals":
    case "is":
      return exists(`AND LOWER(pcm."collectionTitle") = LOWER(${exactParam})`);
    case "contains":
      return exists(`AND pcm."collectionTitle" ILIKE ${valueParam}`);
    case "does not equal":
    case "is not":
      return `NOT ${exists(`AND LOWER(pcm."collectionTitle") = LOWER(${exactParam})`)}`;
    case "does not contain":
      return `NOT ${exists(`AND pcm."collectionTitle" ILIKE ${valueParam}`)}`;
    case "is empty":
    case "is empty/blank":
      return `NOT ${exists()}`;
    case "is not empty":
      return exists();
    default:
      return "TRUE";
  }
};

const buildVariantExistsCondition = ({
  batchField,
  field,
  operator,
  value,
  builder,
  kind,
}) => {
  const condition =
    kind === "number"
      ? buildNumberCondition("v", field, operator, value, builder)
      : kind === "boolean"
        ? buildBooleanCondition("v", field, operator, value, builder)
        : buildStringCondition("v", field, operator, value, builder);

  return `
    EXISTS (
      SELECT 1
      FROM "Variant" v
      WHERE v."shop" = p."shop"
        AND v."productId" = p."id"
        AND v.${quoteIdent(batchField)} = p.${quoteIdent(batchField)}
        AND ${condition}
    )
  `;
};

const buildFilterCondition = ({ filter, batchField, batchId, builder }) => {
  const field = filter?.field;
  const operator = filter?.operator;
  const value = filter?.value;

  if (!field) {
    return "TRUE";
  }

  if (field === "search") {
    const param = builder.param(`%${String(value ?? "")}%`);
    return `(
      p."title" ILIKE ${param}
      OR p."vendor" ILIKE ${param}
      OR p."productType" ILIKE ${param}
      OR p."handle" ILIKE ${param}
      OR p."descriptionText" ILIKE ${param}
      OR p."categoryName" ILIKE ${param}
    )`;
  }

  if (field === "tag") {
    return buildTagCondition(operator, value, builder);
  }

  if (field === "collection") {
    return buildCollectionCondition({ batchId, operator, value, builder });
  }

  if (field === "seo" || field === "seo_visibility") {
    return normalizeBoolean(value)
      ? `(p."seoTitle" IS NOT NULL OR p."seoDescription" IS NOT NULL)`
      : `(p."seoTitle" IS NULL AND p."seoDescription" IS NULL)`;
  }

  if (PRODUCT_STRING_FIELDS[field]) {
    const normalizedValue = field === "status" ? String(value).toUpperCase() : value;
    return buildStringCondition(
      "p",
      PRODUCT_STRING_FIELDS[field],
      operator,
      normalizedValue,
      builder,
    );
  }

  if (PRODUCT_NUMBER_FIELDS[field]) {
    return buildNumberCondition(
      "p",
      PRODUCT_NUMBER_FIELDS[field],
      operator,
      value,
      builder,
    );
  }

  if (PRODUCT_DATE_FIELDS[field]) {
    return buildDateCondition("p", PRODUCT_DATE_FIELDS[field], operator, value, builder);
  }

  if (PRODUCT_BOOLEAN_FIELDS[field]) {
    return buildBooleanCondition(
      "p",
      PRODUCT_BOOLEAN_FIELDS[field],
      operator,
      value,
      builder,
    );
  }

  if (VARIANT_STRING_FIELDS[field]) {
    return buildVariantExistsCondition({
      batchField,
      field: VARIANT_STRING_FIELDS[field],
      operator,
      value,
      builder,
      kind: "string",
    });
  }

  if (VARIANT_NUMBER_FIELDS[field]) {
    return buildVariantExistsCondition({
      batchField,
      field: VARIANT_NUMBER_FIELDS[field],
      operator,
      value,
      builder,
      kind: "number",
    });
  }

  if (VARIANT_BOOLEAN_FIELDS[field]) {
    return buildVariantExistsCondition({
      batchField,
      field: VARIANT_BOOLEAN_FIELDS[field],
      operator,
      value,
      builder,
      kind: "boolean",
    });
  }

  return "TRUE";
};

const buildTargetSql = ({ shop, batchField, batchId, filterParams, targetLevel }) => {
  const builder = makeSqlBuilder();
  const whereClauses = [
    `p."shop" = ${builder.param(shop)}`,
    `p.${quoteIdent(batchField)} = ${builder.param(batchId)}`,
  ];

  for (const filter of Array.isArray(filterParams) ? filterParams : []) {
    whereClauses.push(
      buildFilterCondition({ filter, batchField, batchId, builder }),
    );
  }

  const whereSql = whereClauses.map((clause) => `(${clause})`).join("\n    AND ");

  if (targetLevel === "VARIANT") {
    return {
      text: `
        SELECT COUNT(*)::bigint AS count
        FROM "Product" p
        JOIN "Variant" target_variant
          ON target_variant."shop" = p."shop"
         AND target_variant."productId" = p."id"
         AND target_variant.${quoteIdent(batchField)} = p.${quoteIdent(batchField)}
        WHERE ${whereSql}
      `,
      values: builder.values,
    };
  }

  return {
    text: `
      SELECT COUNT(*)::bigint AS count
      FROM "Product" p
      WHERE ${whereSql}
    `,
    values: builder.values,
  };
};

const getActiveBatches = async (client, shop) => {
  const result = await client.query(
    `
      SELECT
        store."activeMirrorBatchId" AS "oldMirrorBatchId",
        active."catalogBatchId" AS "newCatalogBatchId",
        active."isConsistent" AS "isConsistent"
      FROM "Store" store
      LEFT JOIN "ActiveCatalogSnapshot" active
        ON active."shop" = store."shopUrl"
      WHERE store."shopUrl" = $1
    `,
    [shop],
  );
  const row = result.rows[0] || {};

  return {
    oldMirrorBatchId: row.oldMirrorBatchId || null,
    newCatalogBatchId: row.newCatalogBatchId || null,
    activeSnapshot: row.newCatalogBatchId
      ? {
          catalogBatchId: row.newCatalogBatchId,
          isConsistent: row.isConsistent,
        }
      : null,
  };
};

const countTargets = async ({ client, shop, batchField, batchId, filterParams, targetLevel }) => {
  const query = buildTargetSql({
    shop,
    batchField,
    batchId,
    filterParams,
    targetLevel,
  });
  const result = await client.query(query.text, query.values);
  return Number(result.rows[0]?.count || 0);
};

const compareSurface = async ({
  client,
  name,
  shop,
  oldMirrorBatchId,
  newCatalogBatchId,
  filterParams,
  targetLevel,
}) => {
  const [oldCount, newCount] = await Promise.all([
    countTargets({
      client,
      shop,
      batchField: "mirrorBatchId",
      batchId: oldMirrorBatchId,
      filterParams,
      targetLevel,
    }),
    countTargets({
      client,
      shop,
      batchField: "catalogBatchId",
      batchId: newCatalogBatchId,
      filterParams,
      targetLevel,
    }),
  ]);

  return {
    surface: name,
    targetLevel,
    oldCount,
    newCount,
    parity: oldCount === newCount,
  };
};

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const shop = readArgValue("--shop");
  if (!shop) {
    throw new Error("--shop is required");
  }

  const filterParams = readFilterParams();
  const targetLevel =
    String(readArgValue("--target-level") || "PRODUCT").toUpperCase() ===
    "VARIANT"
      ? "VARIANT"
      : "PRODUCT";
  const client = new Client({
    connectionString: normalizePostgresConnectionString(process.env.DATABASE_URL),
  });

  await client.connect();

  try {
    await assertSchemaReady(client);

    const { oldMirrorBatchId, newCatalogBatchId, activeSnapshot } =
      await getActiveBatches(client, shop);

    if (!oldMirrorBatchId || !newCatalogBatchId) {
      throw new Error(
        `Both Store.activeMirrorBatchId and ActiveCatalogSnapshot.catalogBatchId are required for parity. old=${oldMirrorBatchId || "null"} new=${newCatalogBatchId || "null"}`,
      );
    }

    const surfaces = await Promise.all([
      compareSurface({
        client,
        name: "preview",
        shop,
        oldMirrorBatchId,
        newCatalogBatchId,
        filterParams,
        targetLevel,
      }),
      compareSurface({
        client,
        name: "export",
        shop,
        oldMirrorBatchId,
        newCatalogBatchId,
        filterParams,
        targetLevel,
      }),
      compareSurface({
        client,
        name: "execute",
        shop,
        oldMirrorBatchId,
        newCatalogBatchId,
        filterParams,
        targetLevel,
      }),
      compareSurface({
        client,
        name: "undo_replay",
        shop,
        oldMirrorBatchId,
        newCatalogBatchId,
        filterParams,
        targetLevel,
      }),
    ]);
    const failures = surfaces.filter((surface) => !surface.parity);

    console.log(
      serialize({
        generatedAt: new Date().toISOString(),
        shop,
        oldMirrorBatchId,
        newCatalogBatchId,
        activeSnapshot,
        targetLevel,
        filterParams,
        parityPassed: failures.length === 0,
        surfaces,
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
