import { Prisma } from "../../generated/prisma/index.js";

const PRODUCT_FIELDS = {
  title: { column: "title", type: "string" },
  vendor: { column: "vendor", type: "string" },
  handle: { column: "handle", type: "string" },
  description: { column: "descriptionText", type: "string" },
  product_type: { column: "productType", type: "string" },
  productType: { column: "productType", type: "string" },
  status: {
    column: "status",
    type: "string",
    transform: (value) => String(value).toUpperCase(),
  },
  inventory_q: { column: "totalInventory", type: "number" },
  totalInventory: { column: "totalInventory", type: "number" },
  created_at: { column: "createdAt", type: "date" },
  createdAt: { column: "createdAt", type: "date" },
  updated_at: { column: "updatedAt", type: "date" },
  updatedAt: { column: "updatedAt", type: "date" },
  published_at: { column: "publishedAt", type: "date" },
  publishedAt: { column: "publishedAt", type: "date" },
  product_id: { column: "id", type: "string" },
  id: { column: "id", type: "string" },
  category: { column: "categoryName", type: "string" },
  categoryName: { column: "categoryName", type: "string" },
  theme_template: { column: "templateSuffix", type: "string" },
  templateSuffix: { column: "templateSuffix", type: "string" },
  variant_count: { column: "variantCount", type: "number" },
  variantCount: { column: "variantCount", type: "number" },
  vc: { column: "variantCount", type: "number" },
  option_name_1: { column: "option1Name", type: "string" },
  option1Name: { column: "option1Name", type: "string" },
  option_name_2: { column: "option2Name", type: "string" },
  option2Name: { column: "option2Name", type: "string" },
  option_name_3: { column: "option3Name", type: "string" },
  option3Name: { column: "option3Name", type: "string" },
  visible_online_store: { column: "visibleOnlineStore", type: "boolean" },
  visibleOnlineStore: { column: "visibleOnlineStore", type: "boolean" },
};

const VARIANT_FIELDS = {
  sku: { column: "sku", type: "string" },
  barcode: { column: "barcode", type: "string" },
  variant_title: { column: "title", type: "string" },
  price: { column: "price", type: "number" },
  compare_at_price: { column: "compareAtPrice", type: "number" },
  compareAtPrice: { column: "compareAtPrice", type: "number" },
  variant_inventory_q: { column: "inventoryQuantity", type: "number" },
  inventoryQuantity: { column: "inventoryQuantity", type: "number" },
  charge_tax: { column: "taxable", type: "boolean" },
  taxable: { column: "taxable", type: "boolean" },
  cost: { column: "cost", type: "number" },
  country_of_origin: { column: "countryOfOrigin", type: "string" },
  countryOfOrigin: { column: "countryOfOrigin", type: "string" },
  hs_tariff_code: { column: "hsTariffCode", type: "string" },
  hsTariffCode: { column: "hsTariffCode", type: "string" },
  inventory_policy: { column: "inventoryPolicy", type: "string" },
  inventoryPolicy: { column: "inventoryPolicy", type: "string" },
  inventory_out_of_stock_policy: { column: "inventoryPolicy", type: "string" },
  option_value_1: { column: "option1Value", type: "string" },
  option1Value: { column: "option1Value", type: "string" },
  option_value_2: { column: "option2Value", type: "string" },
  option2Value: { column: "option2Value", type: "string" },
  option_value_3: { column: "option3Value", type: "string" },
  option3Value: { column: "option3Value", type: "string" },
  physical_product: { column: "physicalProduct", type: "boolean" },
  physicalProduct: { column: "physicalProduct", type: "boolean" },
  track_quantity: { column: "tracked", type: "boolean" },
  tracked: { column: "tracked", type: "boolean" },
  profit_margin: { column: "profitMargin", type: "number" },
  profitMargin: { column: "profitMargin", type: "number" },
  weight: { column: "weight", type: "number" },
  weight_unit: { column: "weightUnit", type: "string" },
  weightUnit: { column: "weightUnit", type: "string" },
};

function q(identifier) {
  return Prisma.raw(`"${String(identifier).replace(/"/g, '""')}"`);
}

function normalizeOperator(operator) {
  return String(operator || "").trim().toLowerCase();
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes", "active"].includes(String(value).toLowerCase());
}

function normalizeFilterList(value) {
  return Array.isArray(value) ? value : [value];
}

function compileScalar({ alias, column, type, operator, value, transform }) {
  const op = normalizeOperator(operator);
  const col = Prisma.sql`${Prisma.raw(alias)}.${q(column)}`;
  const val = transform ? transform(value) : value;

  if (["is empty", "is empty/blank"].includes(op)) {
    if (type === "string") {
      return Prisma.sql`(${col} IS NULL OR ${col} = '')`;
    }
    return Prisma.sql`${col} IS NULL`;
  }

  if (op === "is not empty") {
    if (type === "string") {
      return Prisma.sql`(${col} IS NOT NULL AND ${col} <> '')`;
    }
    return Prisma.sql`${col} IS NOT NULL`;
  }

  if (type === "string") {
    if (["equals", "is", "="].includes(op)) return Prisma.sql`${col} ILIKE ${String(val)}`;
    if (["is not", "does not equal", "!="].includes(op)) return Prisma.sql`(${col} IS NULL OR ${col} NOT ILIKE ${String(val)})`;
    if (op === "contains") return Prisma.sql`${col} ILIKE ${`%${String(val)}%`}`;
    if (op === "does not contain") return Prisma.sql`(${col} IS NULL OR ${col} NOT ILIKE ${`%${String(val)}%`})`;
    if (op === "starts with") return Prisma.sql`${col} ILIKE ${`${String(val)}%`}`;
    if (op === "ends with") return Prisma.sql`${col} ILIKE ${`%${String(val)}`}`;
    if (op === "in") return Prisma.sql`${col} IN (${Prisma.join(normalizeFilterList(val).map(String))})`;
  }

  if (type === "number") {
    if (op === "in") {
      const values = normalizeFilterList(val)
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item));
      if (!values.length) throw new Error(`Invalid numeric filter value for ${column}`);
      return Prisma.sql`${col} IN (${Prisma.join(values)})`;
    }

    const n = Number(val);
    if (!Number.isFinite(n)) throw new Error(`Invalid numeric filter value for ${column}`);

    if (["equals", "is", "="].includes(op)) return Prisma.sql`${col} = ${n}`;
    if (["!=", "does not equal", "is not"].includes(op)) return Prisma.sql`(${col} IS NULL OR ${col} <> ${n})`;
    if ([">", "greater than"].includes(op)) return Prisma.sql`${col} > ${n}`;
    if ([">=", "greater than or equal"].includes(op)) return Prisma.sql`${col} >= ${n}`;
    if (["<", "less than"].includes(op)) return Prisma.sql`${col} < ${n}`;
    if (["<=", "less than or equal"].includes(op)) return Prisma.sql`${col} <= ${n}`;
  }

  if (type === "boolean") {
    const b = normalizeBoolean(val);
    if (["equals", "is", "="].includes(op)) return Prisma.sql`${col} = ${b}`;
    if (["!=", "does not equal", "is not"].includes(op)) return Prisma.sql`${col} <> ${b}`;
  }

  if (type === "date") {
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid date filter value for ${column}`);

    if (op === "is before") return Prisma.sql`${col} < ${d}`;
    if (op === "is after") return Prisma.sql`${col} > ${d}`;
    if (op === "is on") {
      const day = String(val).slice(0, 10);
      const start = new Date(`${day}T00:00:00.000Z`);
      const end = new Date(`${day}T23:59:59.999Z`);
      return Prisma.sql`(${col} >= ${start} AND ${col} <= ${end})`;
    }
  }

  throw new Error(`Unsupported operator "${operator}" for ${column}`);
}

function compileTagFilter(filter) {
  const op = normalizeOperator(filter.operator);
  const value = String(filter.value || "").trim();

  if (["contains", "equals", "is"].includes(op)) {
    return Prisma.sql`${value} = ANY(p."tags")`;
  }

  if (["does not contain", "does not equal", "is not"].includes(op)) {
    return Prisma.sql`NOT (${value} = ANY(p."tags"))`;
  }

  if (op === "in") {
    const values = normalizeFilterList(filter.value).map(String);
    return Prisma.sql`p."tags" && ARRAY[${Prisma.join(values)}]::text[]`;
  }

  if (["is empty", "is empty/blank"].includes(op)) {
    return Prisma.sql`CARDINALITY(p."tags") = 0`;
  }

  if (op === "is not empty") {
    return Prisma.sql`CARDINALITY(p."tags") > 0`;
  }

  throw new Error(`Unsupported tag operator: ${filter.operator}`);
}

function compileCollectionFilter(filter) {
  const op = normalizeOperator(filter.operator);
  const value = String(filter.value || "").trim();
  const collectionText = Prisma.sql`LOWER(p."collectionsJson"::text)`;

  if (["is empty", "is empty/blank"].includes(op)) {
    return Prisma.sql`(p."collectionsJson" IS NULL OR p."collectionsJson" = '[]'::jsonb)`;
  }

  if (op === "is not empty") {
    return Prisma.sql`(p."collectionsJson" IS NOT NULL AND p."collectionsJson" <> '[]'::jsonb)`;
  }

  const pattern = `%${value.toLowerCase()}%`;

  if (["contains", "equals", "is"].includes(op)) {
    return Prisma.sql`${collectionText} LIKE ${pattern}`;
  }

  if (["does not contain", "does not equal", "is not"].includes(op)) {
    return Prisma.sql`(p."collectionsJson" IS NULL OR ${collectionText} NOT LIKE ${pattern})`;
  }

  throw new Error(`Unsupported collection operator: ${filter.operator}`);
}

function compileVariantExists(filter) {
  const config = VARIANT_FIELDS[filter.field];
  const condition = compileScalar({
    alias: "v",
    column: config.column,
    type: config.type,
    operator: filter.operator,
    value: filter.value,
    transform: config.transform,
  });

  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM "Variant" v
      WHERE v."shop" = p."shop"
        AND v."productId" = p."id"
        AND v."mirrorBatchId" = p."mirrorBatchId"
        AND ${condition}
    )
  `;
}

function compileProductFilter(filter) {
  if (filter.field === "search") {
    const value = `%${String(filter.value || "").trim()}%`;
    return Prisma.sql`(
      p."title" ILIKE ${value}
      OR p."vendor" ILIKE ${value}
      OR p."productType" ILIKE ${value}
      OR p."handle" ILIKE ${value}
      OR p."descriptionText" ILIKE ${value}
      OR p."categoryName" ILIKE ${value}
    )`;
  }

  if (filter.field === "tag" || filter.field === "tags") return compileTagFilter(filter);
  if (filter.field === "collection" || filter.field === "collections") {
    return compileCollectionFilter(filter);
  }

  const config = PRODUCT_FIELDS[filter.field];
  if (!config) throw new Error(`Unsupported product filter field: ${filter.field}`);

  return compileScalar({
    alias: "p",
    column: config.column,
    type: config.type,
    operator: filter.operator,
    value: filter.value,
    transform: config.transform,
  });
}

export function compileProductWhereSql({ shop, mirrorBatchId, filterParams = [] }) {
  if (!shop) throw new Error("shop is required");
  if (!mirrorBatchId) throw new Error("mirrorBatchId is required");

  const clauses = [
    Prisma.sql`p."shop" = ${shop}`,
    Prisma.sql`p."mirrorBatchId" = ${mirrorBatchId}`,
  ];

  for (const filter of filterParams || []) {
    if (!filter?.field) continue;

    if (VARIANT_FIELDS[filter.field]) {
      clauses.push(compileVariantExists(filter));
    } else {
      clauses.push(compileProductFilter(filter));
    }
  }

  return Prisma.sql`${Prisma.join(clauses, " AND ")}`;
}

export function compileOrderBySql(sortKey = "TITLE", sortOrder = "asc") {
  const direction =
    String(sortOrder).toLowerCase() === "desc"
      ? Prisma.raw("DESC")
      : Prisma.raw("ASC");

  const map = {
    CREATED_AT: Prisma.sql`p."createdAt"`,
    ID: Prisma.sql`p."id"`,
    INVENTORY_TOTAL: Prisma.sql`p."totalInventory"`,
    PRODUCT_TYPE: Prisma.sql`p."productType"`,
    PUBLISHED_AT: Prisma.sql`p."publishedAt"`,
    TITLE: Prisma.sql`p."title"`,
    UPDATED_AT: Prisma.sql`p."updatedAt"`,
    VENDOR: Prisma.sql`p."vendor"`,
  };

  return Prisma.sql`${map[sortKey] || map.TITLE} ${direction}, p."id" ASC`;
}
