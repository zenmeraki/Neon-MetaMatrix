import { Parser } from "json2csv";
import { fieldMappings } from "../../utils/productExportUtils.js";
import { graphqlProductsExportQuery  } from "../../graphql/product.js";
import CacheService from "../../utils/cacheService.js";
import { EXPORT_TYPES } from "../../Config/constants.js";
import { getCache, setCache } from "../../utils/cacheUtils.js";
import { prisma } from "../../Config/database.js";
import { adminGraphqlWithRetry } from "../../utils/shopifyAdminApi.js";
import { addbulkExportJob } from "../../Jobs/Queues/bulkExportJob.js";
import { logBatchEvent } from "../../utils/batchObservability.js";
import { sha256Hex } from "../../utils/deterministicHashUtils.js";
import * as exportJobRepository from "../../repositories/exportJobRepository.js";
import { EXPORT_EXECUTION_STATES } from "../exportExecutionStateService.js";
import { getActiveCatalogSnapshot } from "../sync/catalogSnapshotService.js";
import {
  freezeTargetSnapshot,
  resolveCanonicalProductTarget,
} from "./productTargetingService.js";

async function tryExportStartLock(client, lockKey) {
  const rows = await client.$queryRaw`
    SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS locked
  `;
  return Boolean(rows?.[0]?.locked);
}

const normalizeExportFilename = (fileName) =>
  /\.csv$/i.test(fileName) ? fileName : `${fileName}.csv`;

const FILENAME_MAX_LENGTH = 120;
const WINDOWS_RESERVED_FILENAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

const STRING_FILTER_OPERATORS = new Set([
  "equals",
  "is",
  "does not equal",
  "is not",
  "contains",
  "does not contain",
  "starts with",
  "ends with",
  "is empty",
  "is empty/blank",
  "is not empty",
]);
const NUMBER_FILTER_OPERATORS = new Set([
  "<",
  "<=",
  ">",
  ">=",
  "=",
  "!=",
  "equals",
  "is",
  "is not",
  "does not equal",
  "less than",
  "less than or equal",
  "greater than",
  "greater than or equal",
  "is empty",
  "is empty/blank",
  "is not empty",
]);
const DATE_FILTER_OPERATORS = new Set([
  "is before",
  "is after",
  "is on",
  "is before x days ago",
  "is after x days ago",
  "is empty",
  "is empty/blank",
  "is not empty",
]);
const BOOLEAN_FILTER_OPERATORS = new Set([
  "equals",
  "is",
  "=",
  "does not equal",
  "is not",
  "!=",
  "is empty",
  "is empty/blank",
  "is not empty",
]);
const EMPTY_VALUE_FILTER_OPERATORS = new Set([
  "is empty",
  "is empty/blank",
  "is not empty",
]);
const FILTER_FIELD_OPERATOR_SETS = new Map([
  ["search", STRING_FILTER_OPERATORS],
  ["title", STRING_FILTER_OPERATORS],
  ["vendor", STRING_FILTER_OPERATORS],
  ["handle", STRING_FILTER_OPERATORS],
  ["description", STRING_FILTER_OPERATORS],
  ["product_type", STRING_FILTER_OPERATORS],
  ["status", STRING_FILTER_OPERATORS],
  ["product_id", STRING_FILTER_OPERATORS],
  ["category", STRING_FILTER_OPERATORS],
  ["tag", STRING_FILTER_OPERATORS],
  ["theme_template", STRING_FILTER_OPERATORS],
  ["collection", STRING_FILTER_OPERATORS],
  ["option_name_1", STRING_FILTER_OPERATORS],
  ["option_name_2", STRING_FILTER_OPERATORS],
  ["option_name_3", STRING_FILTER_OPERATORS],
  ["googleShoppingAgeGroup", STRING_FILTER_OPERATORS],
  ["google_shopping_age_group", STRING_FILTER_OPERATORS],
  ["googleShoppingCategory", STRING_FILTER_OPERATORS],
  ["google_shopping_category", STRING_FILTER_OPERATORS],
  ["googleShoppingColor", STRING_FILTER_OPERATORS],
  ["google_shopping_color", STRING_FILTER_OPERATORS],
  ["googleShoppingCondition", STRING_FILTER_OPERATORS],
  ["google_shopping_condition", STRING_FILTER_OPERATORS],
  ["googleShoppingCustomLabel0", STRING_FILTER_OPERATORS],
  ["google_shopping_custom_label_0", STRING_FILTER_OPERATORS],
  ["googleShoppingCustomLabel1", STRING_FILTER_OPERATORS],
  ["google_shopping_custom_label_1", STRING_FILTER_OPERATORS],
  ["googleShoppingCustomLabel2", STRING_FILTER_OPERATORS],
  ["google_shopping_custom_label_2", STRING_FILTER_OPERATORS],
  ["googleShoppingCustomLabel3", STRING_FILTER_OPERATORS],
  ["google_shopping_custom_label_3", STRING_FILTER_OPERATORS],
  ["googleShoppingCustomLabel4", STRING_FILTER_OPERATORS],
  ["google_shopping_custom_label_4", STRING_FILTER_OPERATORS],
  ["googleShoppingGender", STRING_FILTER_OPERATORS],
  ["google_shopping_gender", STRING_FILTER_OPERATORS],
  ["googleShoppingMpn", STRING_FILTER_OPERATORS],
  ["google_shopping_mpn", STRING_FILTER_OPERATORS],
  ["googleShoppingMaterial", STRING_FILTER_OPERATORS],
  ["google_shopping_material", STRING_FILTER_OPERATORS],
  ["googleShoppingSize", STRING_FILTER_OPERATORS],
  ["google_shopping_size", STRING_FILTER_OPERATORS],
  ["googleShoppingSizeSystem", STRING_FILTER_OPERATORS],
  ["google_shopping_size_system", STRING_FILTER_OPERATORS],
  ["googleShoppingSizeType", STRING_FILTER_OPERATORS],
  ["google_shopping_size_type", STRING_FILTER_OPERATORS],
  ["categoryAgeGroup", STRING_FILTER_OPERATORS],
  ["category_age_group", STRING_FILTER_OPERATORS],
  ["categoryColor", STRING_FILTER_OPERATORS],
  ["category_color", STRING_FILTER_OPERATORS],
  ["categoryFabric", STRING_FILTER_OPERATORS],
  ["category_fabric", STRING_FILTER_OPERATORS],
  ["categoryFit", STRING_FILTER_OPERATORS],
  ["category_fit", STRING_FILTER_OPERATORS],
  ["categorySize", STRING_FILTER_OPERATORS],
  ["category_size", STRING_FILTER_OPERATORS],
  ["categoryTargetGender", STRING_FILTER_OPERATORS],
  ["category_target_gender", STRING_FILTER_OPERATORS],
  ["categoryWaistRise", STRING_FILTER_OPERATORS],
  ["category_waist_rise", STRING_FILTER_OPERATORS],
  ["sku", STRING_FILTER_OPERATORS],
  ["barcode", STRING_FILTER_OPERATORS],
  ["variant_title", STRING_FILTER_OPERATORS],
  ["country_of_origin", STRING_FILTER_OPERATORS],
  ["hs_tariff_code", STRING_FILTER_OPERATORS],
  ["inventory_policy", STRING_FILTER_OPERATORS],
  ["inventory_out_of_stock_policy", STRING_FILTER_OPERATORS],
  ["option_value_1", STRING_FILTER_OPERATORS],
  ["option_value_2", STRING_FILTER_OPERATORS],
  ["option_value_3", STRING_FILTER_OPERATORS],
  ["weight_unit", STRING_FILTER_OPERATORS],
  ["inventory_q", NUMBER_FILTER_OPERATORS],
  ["variant_count", NUMBER_FILTER_OPERATORS],
  ["vc", NUMBER_FILTER_OPERATORS],
  ["price", NUMBER_FILTER_OPERATORS],
  ["compare_at_price", NUMBER_FILTER_OPERATORS],
  ["variant_inventory_q", NUMBER_FILTER_OPERATORS],
  ["cost", NUMBER_FILTER_OPERATORS],
  ["profit_margin", NUMBER_FILTER_OPERATORS],
  ["weight", NUMBER_FILTER_OPERATORS],
  ["created_at", DATE_FILTER_OPERATORS],
  ["updated_at", DATE_FILTER_OPERATORS],
  ["published_at", DATE_FILTER_OPERATORS],
  ["visible_online_store", BOOLEAN_FILTER_OPERATORS],
  ["googleShoppingEnabled", BOOLEAN_FILTER_OPERATORS],
  ["google_shopping_enabled", BOOLEAN_FILTER_OPERATORS],
  ["googleShoppingCustomProduct", BOOLEAN_FILTER_OPERATORS],
  ["google_shopping_custom_product", BOOLEAN_FILTER_OPERATORS],
  ["charge_tax", BOOLEAN_FILTER_OPERATORS],
  ["physical_product", BOOLEAN_FILTER_OPERATORS],
  ["track_quantity", BOOLEAN_FILTER_OPERATORS],
  ["seo", BOOLEAN_FILTER_OPERATORS],
  ["seo_visibility", BOOLEAN_FILTER_OPERATORS],
]);
const EXPORT_FIELD_NAMES = new Set(Object.keys(fieldMappings));

function buildHttpError(message, httpStatus = 400, code = "EXPORT_VALIDATION_ERROR") {
  const error = new Error(message);
  error.httpStatus = httpStatus;
  error.code = code;
  return error;
}

function sanitizeExportFilename(fileName) {
  const rawBaseName = String(fileName || "")
    .replace(/[\r\n\t]/g, " ")
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "");
  const withoutExtension = rawBaseName.replace(/\.csv$/i, "");
  const safeBaseName = withoutExtension
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, FILENAME_MAX_LENGTH)
    .replace(/[._-]+$/, "");
  const resolvedBaseName = safeBaseName || "export";
  const normalizedBaseName = WINDOWS_RESERVED_FILENAMES.has(
    resolvedBaseName.toLowerCase(),
  )
    ? `${resolvedBaseName}_export`
    : resolvedBaseName;

  return `${normalizedBaseName}.csv`;
}

function validateExportFilterParams(filterParams) {
  if (filterParams === null || typeof filterParams === "undefined") {
    return [];
  }

  if (!Array.isArray(filterParams)) {
    throw buildHttpError("filterParams must be an array");
  }

  if (filterParams.length > 100) {
    throw buildHttpError("Too many filters selected");
  }

  return filterParams.map((filter, index) => {
    if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
      throw buildHttpError(`Invalid filter at index ${index}`);
    }

    const field = String(filter.field || "").trim();
    if (!field) {
      throw buildHttpError(`Filter field is required at index ${index}`);
    }

    const allowedOperators = FILTER_FIELD_OPERATOR_SETS.get(field);
    if (!allowedOperators) {
      throw buildHttpError(`Unsupported filter field: ${field}`);
    }

    const operator = String(filter.operator || "").trim();
    if (!operator || !allowedOperators.has(operator)) {
      throw buildHttpError(`Unsupported operator for filter field: ${field}`);
    }

    const hasValue =
      Object.prototype.hasOwnProperty.call(filter, "value") &&
      filter.value !== null &&
      typeof filter.value !== "undefined" &&
      String(filter.value).trim() !== "";
    if (!hasValue && !EMPTY_VALUE_FILTER_OPERATORS.has(operator)) {
      throw buildHttpError(`Filter value is required for field: ${field}`);
    }

    return {
      field,
      operator,
      value: filter.value,
    };
  });
}

export class ProductExportService {
  constructor(session) {
    this.session = session;
    this.fieldMappings = fieldMappings;
  }

  async startExport({ fields, fileName, filterParams }) {
    const shop = this.session?.shop;

    if (!shop) {
      const error = new Error("Unauthorized");
      error.httpStatus = 401;
      throw error;
    }

    if (!Array.isArray(fields) || fields.length === 0) {
      throw buildHttpError("No fields selected");
    }

    const invalidField = fields.find((field) => !EXPORT_FIELD_NAMES.has(field));
    if (invalidField) {
      throw buildHttpError(`Unsupported export field: ${invalidField}`);
    }

    if (!fileName?.trim()) {
      throw buildHttpError("File name required");
    }

    const filename = sanitizeExportFilename(normalizeExportFilename(fileName.trim()));
    const validatedFilterParams = validateExportFilterParams(filterParams);
    const idempotencyKey = sha256Hex({
      shop,
      filterParams: validatedFilterParams,
      fields,
      filename,
    });
    const activeSnapshot = await getActiveCatalogSnapshot({ shop });
    if (!activeSnapshot?.catalogBatchId || activeSnapshot.isConsistent !== true) {
      const error = new Error("Active catalog snapshot is not consistent");
      error.httpStatus = 409;
      error.code = "ACTIVE_CATALOG_SNAPSHOT_INCONSISTENT";
      error.details = {
        shop,
        snapshotId: activeSnapshot?.snapshotId || null,
        catalogBatchId: activeSnapshot?.catalogBatchId || null,
        reason: activeSnapshot?.reason || "active_catalog_snapshot_missing",
      };
      throw error;
    }

    const target = await resolveCanonicalProductTarget({
      shop,
      filterParams: validatedFilterParams,
      sampleLimit: 0,
      path: "export",
      snapshot: activeSnapshot,
    });
    const lockKey = `manual-export:${shop}:${idempotencyKey}`;

    const { job, frozenSnapshot, reused } = await prisma.$transaction(
      async (tx) => {
        const locked = await tryExportStartLock(tx, lockKey);
        if (!locked) {
          const conflict = new Error("Export start is already in progress");
          conflict.httpStatus = 409;
          throw conflict;
        }

        const existingJob = await exportJobRepository.findActiveManualExportByIdempotencyKey({
          shop,
          filename,
          idempotencyKey,
          executionStates: [
            EXPORT_EXECUTION_STATES.PLANNED,
            EXPORT_EXECUTION_STATES.QUEUED,
            EXPORT_EXECUTION_STATES.RUNNING,
            EXPORT_EXECUTION_STATES.FINALIZING,
          ],
          statuses: ["PENDING", "PROCESSING"],
          client: tx,
        });

        if (existingJob?.targetSnapshotSetId) {
          return {
            job: existingJob,
            frozenSnapshot: {
              targetSnapshotSetId: existingJob.targetSnapshotSetId,
              count: existingJob.targetSnapshotCount,
            },
            reused: true,
          };
        }

        const activeShopExport = await exportJobRepository.findActiveExportForShop({
          shop,
          executionStates: [
            EXPORT_EXECUTION_STATES.PLANNED,
            EXPORT_EXECUTION_STATES.QUEUED,
            EXPORT_EXECUTION_STATES.RUNNING,
            EXPORT_EXECUTION_STATES.FINALIZING,
          ],
          statuses: ["PENDING", "PROCESSING"],
          excludeIdempotencyKey: idempotencyKey,
          client: tx,
        });

        if (activeShopExport) {
          const conflict = new Error("Another export is already active for this shop");
          conflict.httpStatus = 409;
          conflict.code = "SHOP_EXPORT_CONCURRENCY_LIMIT";
          conflict.details = {
            shop,
            activeExportJobId: activeShopExport.id,
          };
          throw conflict;
        }

        const createdJob = await exportJobRepository.createManualExportJob({
          shop,
          filename,
          fields,
          filterQuery: JSON.stringify(target.where),
          status: "PENDING",
          executionState: EXPORT_EXECUTION_STATES.PLANNED,
          targetCatalogBatchId: target.catalogBatchId,
          targetMirrorBatchId: target.mirrorBatchId,
          filterVersion: target.filterVersion,
          canonicalFilterKey: target.canonicalFilterKey,
          idempotencyKey,
          client: tx,
        });

        const snapshot = await freezeTargetSnapshot({
          ownerType: "EXPORT_JOB",
          ownerId: createdJob.id,
          shop,
          where: target.where,
          catalogBatchId: target.catalogBatchId,
          mirrorBatchId: target.mirrorBatchId,
          batchField: target.batchField,
          filterVersion: target.filterVersion,
          canonicalFilterKey: target.canonicalFilterKey,
          compiledWhereHash: target.compiledWhereHash,
          path: "export",
          client: tx,
        });

        const queuedJob = await exportJobRepository.markExportJobQueued({
          id: createdJob.id,
          targetSnapshotCount: snapshot.count,
          targetSnapshotSetId: snapshot.targetSnapshotSetId,
          executionState: EXPORT_EXECUTION_STATES.QUEUED,
          client: tx,
        });

        return {
          job: queuedJob,
          frozenSnapshot: snapshot,
          reused: false,
        };
      },
      { timeout: 120_000 },
    );

    logBatchEvent("catalog_batch_export", {
      shop,
      oldMirrorBatchId:
        target.mirrorBatchId && target.mirrorBatchId !== target.catalogBatchId
          ? target.mirrorBatchId
          : null,
      resolvedCatalogBatchId: target.catalogBatchId,
      path: "export",
      extra: {
        exportJobId: job.id,
        targetSnapshotSetId: frozenSnapshot.targetSnapshotSetId,
        targetCount: frozenSnapshot.count,
        reused,
      },
    });

    if (!reused || job.executionState === EXPORT_EXECUTION_STATES.QUEUED) {
      try {
        await addbulkExportJob({
          exportJobId: job.id,
          shop,
          fields: job.fields,
          source: "manual_export",
          executionId: job.id,
        }, {
          jobId: job.id,
        });
      } catch (error) {
        await exportJobRepository.markExportJobQueueDispatchFailed({
          id: job.id,
          shop,
          queuedState: EXPORT_EXECUTION_STATES.QUEUED,
          failedState: EXPORT_EXECUTION_STATES.FAILED,
          error: error.message || "Failed to enqueue export job",
        }).catch(() => {});
        throw error;
      }
    }

    return {
      success: true,
      exportJobId: job.id,
      status: job.status,
      reused,
    };
  }

  async _countProducts({ queryFilter = null }) {
    try {
      const countData = await adminGraphqlWithRetry({
        session: this.session,
        shop: this.session?.shop,
        operationName: "exportProductsCount",
        data: {
          query: `
            query GetProductsCount($query: String) {
              productsCount(query: $query, limit: null) {
                count
              }
            }
          `,
          variables: { query: queryFilter },
        },
      });
      const count = countData.body.data.productsCount.count;

      return count;
    } catch (err) {
      throw new Error(err.message);
    }
  }

  async fetchProducts({ queryFilter = null, count = 0 }) {
  const cacheKey = `${this.session.shop}:${queryFilter}:export`;
  const cacheData = await CacheService.get(cacheKey);

  if (cacheData) {
    return cacheData;
  }

  let hasNextPage = true;
  let endCursor = null;
  const allProducts = [];

  while (hasNextPage) {
    const response = await adminGraphqlWithRetry({
      session: this.session,
      shop: this.session?.shop,
      operationName: "exportProductsPage",
      data: {
        query: graphqlProductsExportQuery,
        variables: {
          first: 250,
          after: endCursor,
          query: queryFilter || null,
        },
      },
    });

    const connection = response.body?.data?.products;
    const edges = connection?.edges || [];
    const pageInfo = connection?.pageInfo;

    const nodes = edges.map((edge) => ({
      ...edge.node,
      variants: Array.isArray(edge.node?.variants?.edges)
        ? edge.node.variants.edges.map((variantEdge) => variantEdge.node)
        : [],
    }));

    allProducts.push(...nodes);

    hasNextPage = Boolean(pageInfo?.hasNextPage);
    endCursor = pageInfo?.endCursor || null;

    if (count > 0 && allProducts.length >= count) {
      break;
    }
  }

  await setCache(cacheKey, allProducts, 300);
  return allProducts;
}

  _checkValidation(count, activePlan) {
    if (activePlan === "Basic (Monthly)") {
      if (count > 50) {
        throw new Error(
          "You are a basic plan user, you can only export 50 products at a time"
        );
      }
    } else if (activePlan === "Advanced (Monthly)") {
      if (count > 150) {
        throw new Error(
          "You are a pro plan user, you can only export 100 products at a time"
        );
      }
    }
  }

transformToCSV(products, requestedColumns) {
  const csvData = [];

  const getNestedValue = (obj, path, defaultValue = "") =>
  path.reduce((acc, key) => {
    if (acc === null || acc === undefined) return defaultValue;

    const resolvedKey =
      Array.isArray(acc) && !Number.isNaN(Number(key)) ? Number(key) : key;

    return acc[resolvedKey] !== undefined && acc[resolvedKey] !== null
      ? acc[resolvedKey]
      : defaultValue;
  }, obj);

  const safeSplitPop = (val) => (val ? val.toString().split("/").pop() : "");

  products.forEach((product) => {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const featuredImage = product?.featuredMedia?.preview?.image || null;

    if (variants.length > 0) {
      variants.forEach((variant, index) => {
        const row = {};

        requestedColumns.forEach((column) => {
          const path = this.fieldMappings[column]?.split(".") || [];
          let value = "";

          if (path[0] === "variants") {
            value = getNestedValue(variant, path.slice(1));
          } else if (path[0] === "images" && featuredImage) {
            value = getNestedValue(featuredImage, path.slice(1));
          } else {
            value = index === 0 ? getNestedValue(product, path) : "";
          }

          if (column === "Weight") {
            const weight = variant?.inventoryItem?.measurement?.weight;
            value = weight ? `${weight.value} ${weight.unit}` : "Not Specified";
          }

          if (column === "ProductID") {
            value = index === 0 ? safeSplitPop(product.id) : "";
          }

          if (column === "VariantID") {
            value = safeSplitPop(value);
          }

          row[column] =
            value !== null && value !== undefined ? value.toString() : "";
        });

        csvData.push(row);
      });
    } else {
      const row = {};

      requestedColumns.forEach((column) => {
        const path = this.fieldMappings[column]?.split(".") || [];
        let value =
          path[0] === "images" && featuredImage
            ? getNestedValue(featuredImage, path.slice(1))
            : getNestedValue(product, path);

        if (column === "VariantID") value = safeSplitPop(value);
        if (column === "ProductID") value = safeSplitPop(product.id);

        row[column] =
          value !== null && value !== undefined ? value.toString() : "";
      });

      csvData.push(row);
    }
  });

  const parser = new Parser();
  return parser.parse(csvData);
}
  async getAllExportHistories(lang) {
    const cacheKey = `${this.session.shop}:fetchExportHistories:${lang}`;

    const cacheHistories = await getCache(cacheKey);
    if (cacheHistories) return cacheHistories;

    // ✅ CONVERTED TO PRISMA
    const histories = await exportJobRepository.listExportJobsForShop({
      shop: this.session.shop,
      take: 10,
    });

    const formatedHistory = histories.map((history) => ({
      ...history,
      targetBatchField: "catalogBatchId",
      targetCatalogBatchId:
        history.targetCatalogBatchId || history.targetMirrorBatchId || null,
      rawType: history.type || "",
      type: EXPORT_TYPES[history.type]?.[lang] || history.type || "",
    }));

    await setCache(cacheKey, formatedHistory, 300);
    return formatedHistory;
  }

  async getExportHistoryDetails(id) {
  if (!id || id === "undefined" || id === "null") {
    throw new Error("Invalid export history ID");
  }

  const history = await exportJobRepository.findExportJobForShop({
    id,
    shop: this.session.shop,
  });

  if (!history) {
    throw new Error("export history not found");
  }

  return {
    ...history,
    targetBatchField: "catalogBatchId",
    targetCatalogBatchId:
      history.targetCatalogBatchId || history.targetMirrorBatchId || null,
  };
}
}
