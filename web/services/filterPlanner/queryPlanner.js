import { normalizeFilterAst } from "./filterAstNormalizer.js";
import { FILTER_FIELD_REGISTRY } from "./filterRegistry.js";
import { chooseExecutionEngine } from "./queryCostModel.js";
import { compileFilterExecutor } from "./compiledFilterEngine.js";

function normalizePagination(page = 1, limit = 50) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.max(Number(limit) || 50, 1);

  return {
    page: safePage,
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
  };
}

function normalizeEstimatedTotalRows(estimatedTotalRows) {
  const normalized = Number(estimatedTotalRows);

  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error("estimatedTotalRows must be a non-negative finite number");
  }

  return normalized;
}

const SORT_FIELD_MAP = {
  CREATED_AT: {
    key: "CREATED_AT",
    prismaField: "createdAt",
    clickhouseColumn: "created_at",
  },
  ID: {
    key: "ID",
    prismaField: "id",
    clickhouseColumn: "product_id",
  },
  INVENTORY_TOTAL: {
    key: "INVENTORY_TOTAL",
    prismaField: "totalInventory",
    clickhouseColumn: null,
  },
  PRODUCT_TYPE: {
    key: "PRODUCT_TYPE",
    prismaField: "productType",
    clickhouseColumn: null,
  },
  PUBLISHED_AT: {
    key: "PUBLISHED_AT",
    prismaField: "publishedAt",
    clickhouseColumn: null,
  },
  STATUS: {
    key: "STATUS",
    prismaField: "status",
    clickhouseColumn: "status",
  },
  TITLE: {
    key: "TITLE",
    prismaField: "title",
    clickhouseColumn: "title",
  },
  UPDATED_AT: {
    key: "UPDATED_AT",
    prismaField: "updatedAt",
    clickhouseColumn: "updated_at",
  },
  VENDOR: {
    key: "VENDOR",
    prismaField: "vendor",
    clickhouseColumn: "vendor",
  },
};

export function normalizeProductSort(sortKey = "ID", sortOrder = "asc") {
  const key = String(sortKey || "ID")
    .trim()
    .toUpperCase();
  const config = SORT_FIELD_MAP[key] || SORT_FIELD_MAP.ID;
  const order =
    String(sortOrder || "asc")
      .trim()
      .toLowerCase() === "desc"
      ? "desc"
      : "asc";

  return {
    ...config,
    order,
  };
}

export function buildPrismaProductOrderBy(sort) {
  const primary = {
    [sort.prismaField]: sort.order,
  };

  if (sort.prismaField === "id") {
    return [primary];
  }

  return [primary, { id: "asc" }];
}

function attachNodeMetadata(node, path = "root") {
  if (!node || typeof node !== "object") {
    throw new Error(`Invalid AST node at ${path}`);
  }

  if (node.type === "AND" || node.type === "OR") {
    return {
      ...node,
      children: Array.isArray(node.children)
        ? node.children.map((child, index) =>
            attachNodeMetadata(child, `${path}.children[${index}]`)
          )
        : [],
    };
  }

  const config = FILTER_FIELD_REGISTRY[node.field];

  if (!config) {
    throw new Error(`Unsupported filter field at ${path}: ${node.field}`);
  }

  return {
    ...node,
    meta: {
      domain: config.domain,
      type: config.type,
      selectivity: config.selectivity,
      isVariantLevel: Boolean(config.isVariantLevel),
      allowedOperators: config.allowedOperators ?? [],
    },
  };
}

function attachFieldMetadata(ast) {
  return attachNodeMetadata(ast);
}

export function buildQueryPlan({
  filterParams,
  shop,
  mirrorBatchId,
  estimatedTotalRows,
  operation = "preview",
  requiresTransactionalFreshness = false,
  page = 1,
  limit = 50,
  sortKey = "ID",
  sortOrder = "asc",
}) {
  const pagination = normalizePagination(page, limit);
  const safeEstimatedTotalRows =
    normalizeEstimatedTotalRows(estimatedTotalRows);
  const ast = attachFieldMetadata(normalizeFilterAst(filterParams));
  const sort = normalizeProductSort(sortKey, sortOrder);

  const decision = chooseExecutionEngine({
    ast,
    estimatedTotalRows: safeEstimatedTotalRows,
    operation,
    requiresTransactionalFreshness,
  });
  const engine =
    decision.engine === "clickhouse" && !sort.clickhouseColumn
      ? "postgres"
      : decision.engine;
  const reason =
    decision.engine === "clickhouse" && engine === "postgres"
      ? `${decision.reason}:sort_not_available_in_clickhouse`
      : decision.reason;

  if (engine === "clickhouse") {
    const compiledFilter = compileFilterExecutor({
      ast,
      shop,
      mirrorBatchId,
      engine,
      sort,
    });

    return {
      engine: "clickhouse",
      reason,
      ast,
      sort,
      pagination,
      estimatedTotalRows: safeEstimatedTotalRows,
      compiledFilter,
      whereClause: compiledFilter.whereClause,
      joinPlan: compiledFilter.joinPlan,
      requiredIndexes: compiledFilter.requiredIndexes,
      selectPlan: compiledFilter.selectPlan,
      countQuery: compiledFilter.clickhouse.countQuery(),
      productIdQuery: compiledFilter.clickhouse.productIdQuery({
        limit: pagination.limit,
        offset: pagination.offset,
      }),
      productIdPageQuery: compiledFilter.clickhouse.productIdPageQuery({
        limit: pagination.limit,
        offset: pagination.offset,
      }),
      replan: (nextEstimatedTotalRows) =>
        buildQueryPlan({
          filterParams,
          shop,
          mirrorBatchId,
          estimatedTotalRows: nextEstimatedTotalRows,
          operation,
          requiresTransactionalFreshness,
          page: pagination.page,
          limit: pagination.limit,
          sortKey: sort.key,
          sortOrder: sort.order,
        }),
    };
  }

  const compiledFilter = compileFilterExecutor({
    ast,
    shop,
    mirrorBatchId,
    engine: "postgres",
    sort,
  });

  return {
    engine: "postgres",
    reason,
    ast,
    sort,
    pagination,
    estimatedTotalRows: safeEstimatedTotalRows,
    compiledFilter,
    where: compiledFilter.whereClause,
    whereClause: compiledFilter.whereClause,
    joinPlan: compiledFilter.joinPlan,
    requiredIndexes: compiledFilter.requiredIndexes,
    selectPlan: compiledFilter.selectPlan,
    replan: (nextEstimatedTotalRows) =>
      buildQueryPlan({
        filterParams,
        shop,
        mirrorBatchId,
        estimatedTotalRows: nextEstimatedTotalRows,
        operation,
        requiresTransactionalFreshness,
        page: pagination.page,
        limit: pagination.limit,
        sortKey: sort.key,
        sortOrder: sort.order,
      }),
  };
}
