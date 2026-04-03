import crypto from "crypto";
import shopify from "../../shopify.js";
import { uploadToShopifyStagedTarget } from "../../utils/productBulkEditUtils.js";
import {
  bulkOperationMutation,
  getProductSetMutation,
  PRODUCT_SET_MODE,
  stagesUploadMutation,
} from "../../helpers/productBulkOperationHelpers/mutationTemplates.js";
import { Services } from "../../services/productService/productFilterService.js";
import { getUpdatedProducts } from "../../helpers/productBulkOperationHelpers/productUpdateHandler.js";
import { addbulkEditJob } from "../../Jobs/Queues/bulkEditJob.js";
import CacheService from "../../utils/cacheService.js";
import { createMultiLanguage } from "../../utils/googleTranslator.js";
import { FIELD_TRANSLATIONS } from "../../Config/constants.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { FIELD_CONFIGS } from "../../helpers/productBulkOperationHelpers/constants.js";
import { prisma } from "../../config/database.js";
import {
  freezeTargetSnapshot,
  getFrozenTargetProductIds,
  markPreviewExecutionMismatch,
  resolveCanonicalProductTarget,
} from "./productTargetingService.js";
import {
  BULK_EDIT_EXECUTION_STATES,
  appendExecutionError,
  buildExecutionError,
  buildPlannedUndoState,
} from "../bulkEditExecutionStateService.js";
import {
  createIdempotencyFingerprint,
  stableStringify,
  withAdvisoryLock,
} from "../../utils/idempotencyUtils.js";
import logger from "../../utils/loggerUtils.js";
import {
  bindOperationFingerprintToResource,
  markOperationFingerprintFailed,
  reserveOperationFingerprint,
} from "../operationFingerprintService.js";
import { persistEditHistoryTargetingMetadata } from "../historyTargetingMetadataService.js";
import { buildQueueExecutionPayload } from "../../utils/executionIdentity.js";

const OPTION_NAME_FIELDS = new Set([
  "option1Name",
  "option2Name",
  "option3Name",
  "mixed",
]);

const VARIANT_LEVEL_FIELDS = new Set([
  "price",
  "barcode",
  "sku",
  "inventory",
  "taxable",
  "compareAtPrice",
  "option1Values",
  "option2Values",
  "option3Values",
  "inventoryPolicy",
  "cost",
  "requiresShipping",
  "weight",
  "weightUnit",
]);

function isVariantLevelField(field) {
  if (FIELD_CONFIGS?.[field]?.isVariantLevel) return true;
  return VARIANT_LEVEL_FIELDS.has(field);
}

function buildProductInclude(fields = []) {
  if (fields.some((field) => isVariantLevelField(field) || OPTION_NAME_FIELDS.has(field))) {
    return {
      variants: true,
    };
  }

  return undefined;
}

function determineMutationMode(fields = []) {
  const normalizedFields = Array.isArray(fields) ? fields.filter(Boolean) : [];
  const includesDelete = normalizedFields.includes("deleteProducts");
  const includesVariant = normalizedFields.some((field) => isVariantLevelField(field));
  const includesProduct = normalizedFields.some(
    (field) => !isVariantLevelField(field) && field !== "deleteProducts",
  );
  const includesOptionNames = normalizedFields.some((field) => OPTION_NAME_FIELDS.has(field));

  if (includesDelete) {
    return PRODUCT_SET_MODE.PRODUCT_DELETE;
  }

  if (includesOptionNames || (includesProduct && includesVariant)) {
    return PRODUCT_SET_MODE.BOTH;
  }

  if (includesVariant) {
    return PRODUCT_SET_MODE.VARIANT_ONLY;
  }

  return PRODUCT_SET_MODE.PRODUCT_ONLY;
}

function normalizeRules(body) {
  const {
    editedType,
    editedField,
    value,
    searchKey,
    replaceText,
    supportValue,
    rules: explicitRules,
    locationId,
  } = body;

  if (Array.isArray(explicitRules) && explicitRules.length > 0) {
    return explicitRules;
  }

  return [
    {
      field: editedField,
      value,
      editOption: editedType,
      searchKey,
      replaceText,
      supportValue,
      locationId: locationId ?? null,
    },
  ];
}

async function buildHistoryTitle(rules) {
  const updatedTitle = rules
    .map((rule) =>
      getUpdatedProducts({
        field: rule.field,
        editType: rule.editOption,
        value: rule.value,
        supportValue: rule.supportValue,
        searchKey: rule.searchKey,
        replaceText: rule.replaceText,
        returnTitleOnly: true,
      }),
    )
    .filter(Boolean)
    .join(" + ");

  return createMultiLanguage(updatedTitle || "Bulk edit");
}

async function markBulkEditKickoffFailed(historyId, shop, error) {
  const existing = await prisma.editHistory.findFirst({
    where: { id: historyId, shop },
    select: { error: true },
  });

  await prisma.editHistory.updateMany({
    where: {
      id: historyId,
      shop,
      bulkOperationId: null,
      status: { in: ["pending", "processing"] },
    },
    data: {
      status: "failed",
      executionState: BULK_EDIT_EXECUTION_STATES.FAILED,
      failureStage: "queue_enqueue",
      completedAt: new Date(),
      error: appendExecutionError(
        existing?.error,
        buildExecutionError({
          code: "bulk_edit_queue_failure",
          stage: "queue_enqueue",
          message: error.message,
          retryable: true,
        }),
      ),
    },
  });
}

export default class ProductBulkService {
  constructor(session) {
    this.client = new shopify.api.clients.Graphql({ session });
    this.session = session;
  }

  async bulkEditProducts(req) {
    try {
      const historyData = await this._bulkOperationEdit(
        req.body,
        req.subscription || {},
      );
      const fingerprint = createIdempotencyFingerprint("manual_bulk_edit", {
        shop: historyData.shop,
        queryFilter: historyData.queryFilter,
        rules: historyData.rules,
        locationId: historyData.locationId ?? null,
        targetMirrorBatchId: historyData.targetMirrorBatchId ?? null,
      });

      const { result } = await withAdvisoryLock(
        `manual-bulk-edit:${historyData.shop}:${fingerprint}`,
        async () => {
          const reservation = await reserveOperationFingerprint({
            shop: historyData.shop,
            operationType: "manual_bulk_edit",
            fingerprint,
            resourceType: "EDIT_HISTORY",
          });

          if (reservation?.resourceId) {
            const existing = await prisma.editHistory.findFirst({
              where: {
                id: reservation.resourceId,
                shop: historyData.shop,
                status: {
                  in: ["pending", "processing"],
                },
              },
            });

            if (existing) {
              return existing;
            }
          }

          const history = await prisma.editHistory.create({
            data: historyData,
          });

          await persistEditHistoryTargetingMetadata({
            historyId: history.id,
            filterParams: req.body?.filterParams ?? [],
          });

          await bindOperationFingerprintToResource({
            shop: history.shop,
            operationType: "manual_bulk_edit",
            fingerprint,
            resourceId: history.id,
          });

          const frozenCount = await this.freezeEditHistoryTargets(history.id);

          await prisma.editHistory.update({
            where: { id: history.id },
            data: {
              totalItems: frozenCount,
              targetSnapshotCount: frozenCount,
            },
          });

          try {
            await addbulkEditJob(
              buildQueueExecutionPayload(
                {
                  historyId: history.id,
                  shop: history.shop,
                  source: "manual_bulk_edit",
                },
                history,
              ),
            );
          } catch (error) {
            await markBulkEditKickoffFailed(history.id, history.shop, error);
            await markOperationFingerprintFailed({
              shop: history.shop,
              operationType: "manual_bulk_edit",
              fingerprint,
              error,
            });
            throw error;
          }

          await prisma.editHistory.updateMany({
            where: {
              id: history.id,
              shop: history.shop,
              bulkOperationId: null,
              executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
            },
            data: {
              executionState: BULK_EDIT_EXECUTION_STATES.QUEUED,
            },
          });

          await clearKeyCaches(`${history.shop}:fetchHistories`).catch((error) => {
            logger.warn("Failed to clear bulk edit history cache after queue", {
              shop: history.shop,
              historyId: history.id,
              message: error.message,
            });
          });

          return prisma.editHistory.findFirst({
            where: {
              id: history.id,
              shop: history.shop,
            },
          });
        },
      );

      return result;
    } catch (error) {
      throw error;
    }
  }

  async _bulkOperationEdit(body, subscription) {
    const {
      editedField,
      filterParams,
      queryWhere,
      productIds,
      title: explicitTitle,
    } = body;

    if (editedField === "inventory" && !body.locationId) {
      throw new Error("Location ID is required for inventory edits");
    }

    const rules = normalizeRules(body);
    const resolvedTarget = await resolveCanonicalProductTarget({
      shop: this.session.shop,
      filterParams,
      explicitWhere: queryWhere,
      explicitProductIds: Array.isArray(productIds) ? productIds : [],
      queryParams: {
        page: 1,
        limit: 20,
      },
      sampleLimit: 0,
      includeSample: false,
    });

    const count = resolvedTarget.count;
    const limit = subscription?.limit || 100;
    const planName = subscription?.planName || "Free Plan";
    const isUnlimited = subscription?.isUnlimited || false;

    if (!isUnlimited && count > limit) {
      throw new Error(
        `Your current plan (${planName}) allows editing up to ${limit} products at a time. You are trying to edit ${count} products. Please upgrade your plan or reduce the number of products.`,
      );
    }

    const title = explicitTitle || await buildHistoryTitle(rules);

    return {
      shop: this.session.shop,
      title,
      queryFilter: JSON.stringify(resolvedTarget.where),
      rules,
      startedAt: new Date(),
      status: "pending",
      executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
      executionIdentity: crypto.randomUUID(),
      processedCount: 0,
      totalItems: count,
      targetSnapshotCount: 0,
      targetMirrorBatchId: resolvedTarget.mirrorBatchId,
      durationMs: 0,
      batch: {
        frozen: true,
        hasMore: count > 0,
        lastProductId: null,
        size: 75,
        previewCount: count,
        currentBatchTargetCount: 0,
        queuedAt: new Date().toISOString(),
      },
      ...(editedField === "inventory" && { locationId: body.locationId }),
      undo: buildPlannedUndoState({
        allowed: editedField !== "deleteProducts",
      }),
    };
  }

  async freezeEditHistoryTargets(historyId, shop = this.session?.shop) {
    const history = await prisma.editHistory.findFirst({
      where: {
        id: historyId,
        ...(shop ? { shop } : {}),
      },
      select: {
        shop: true,
        queryFilter: true,
        targetMirrorBatchId: true,
        batch: true,
      },
    });

    if (!history) {
      throw new Error("Edit history not found");
    }

    let where;
    try {
      where = JSON.parse(history.queryFilter || "{}");
    } catch {
      throw new Error("Stored edit target is invalid");
    }

    const frozenCount = await freezeTargetSnapshot({
      ownerType: "EDIT_HISTORY",
      ownerId: historyId,
      shop: history.shop,
      where,
      mirrorBatchId: history.targetMirrorBatchId,
    });

    const previewCount = history.batch?.previewCount ?? null;
    if (previewCount !== null && Number(previewCount) !== Number(frozenCount)) {
      await markPreviewExecutionMismatch({
        shop: history.shop,
        ownerType: "EDIT_HISTORY",
        ownerId: historyId,
        previewCount: Number(previewCount),
        frozenCount,
      });
    }

    return frozenCount;
  }

  async _bulkOperationHelper({ formattedProducts, field, fields = [] }) {
    try {
      const operationName = `bulkEditProducts_${Date.now()}`;
      const mode = determineMutationMode(fields.length ? fields : [field]);

      const stagedRes = await this.client.query({
        data: {
          query: stagesUploadMutation,
          variables: {
            input: [
              {
                filename: operationName,
                mimeType: "text/jsonl",
                resource: "BULK_MUTATION_VARIABLES",
                httpMethod: "POST",
              },
            ],
          },
        },
      });

      const userErrors = stagedRes?.body?.data?.stagedUploadsCreate?.userErrors;
      if (userErrors?.length) {
        throw new Error(
          `Shopify API returned errors: ${JSON.stringify(userErrors)}`,
        );
      }

      const target =
        stagedRes?.body?.data?.stagedUploadsCreate?.stagedTargets?.[0];

      if (!target) {
        throw new Error("Failed to get staged upload target from Shopify");
      }

      const keyUrl = await uploadToShopifyStagedTarget(
        target,
        formattedProducts,
      );

      const bulkRes = await this.client.query({
        data: {
          query: bulkOperationMutation,
          variables: {
            mutation: getProductSetMutation(mode),
            stagedUploadPath: keyUrl,
          },
        },
      });

      const bulkErrors =
        bulkRes?.body?.data?.bulkOperationRunMutation?.userErrors;

      if (bulkErrors?.length) {
        throw new Error(
          `Bulk operation returned errors: ${JSON.stringify(bulkErrors)}`,
        );
      }

      const result = bulkRes.body?.data?.bulkOperationRunMutation;

      await CacheService.set(`${this.session.shop}:PRODUCT_UPDATE`, {
        running: true,
      });

      return result;
    } catch (err) {
      throw err;
    }
  }

  async _preparingBulkOperation({ historyId, shop = this.session?.shop }) {
    const history = await prisma.editHistory.findFirst({
      where: {
        id: historyId,
        ...(shop ? { shop } : {}),
      },
      select: {
        shop: true,
        batch: true,
        rules: true,
        targetMirrorBatchId: true,
        targetSnapshotCount: true,
        executionIdentity: true,
      },
    });

    if (!history) {
      throw new Error("Edit history not found");
    }

    const rules = Array.isArray(history.rules) ? history.rules.filter(Boolean) : [];
    if (!rules.length) {
      throw new Error("Edit rules not found");
    }

    const limit = history.batch?.size || 75;
    const cursorId = history.batch?.lastProductId || null;
    const { rows, lastProductId, hasMore } = await getFrozenTargetProductIds({
      ownerType: "EDIT_HISTORY",
      ownerId: historyId,
      shop: history.shop,
      limit,
      cursorId,
    });

    if (!rows.length) {
      return {
        formattedProducts: "",
        changes: [],
        lastProductId: null,
        hasMore: false,
        batchId: crypto
          .createHash("sha1")
          .update(`${history.executionIdentity || historyId}:${cursorId || "start"}:empty`)
          .digest("hex"),
        batchTargetCount: 0,
      };
    }

    const fields = rules.map((rule) => rule.field).filter(Boolean);
    const include = buildProductInclude(fields);
    const orderedIds = rows.map((row) => row.productId);

    const products = await prisma.product.findMany({
      where: {
        shop: history.shop,
        id: {
          in: orderedIds,
        },
        ...(history.targetMirrorBatchId
          ? {
              mirrorBatchId: history.targetMirrorBatchId,
            }
          : {}),
      },
      ...(include ? { include } : {}),
    });

    const productsById = new Map(products.map((product) => [product.id, product]));
    const formattedProducts = [];
    const changes = [];
    const batchId = crypto
      .createHash("sha1")
      .update(
        `${history.executionIdentity || historyId}:${cursorId || "start"}:${lastProductId}:${rows.length}`,
      )
      .digest("hex");

    for (const productId of orderedIds) {
      const rawProduct = productsById.get(productId);
      if (!rawProduct) {
        continue;
      }

      const product = {
        ...rawProduct,
        options: Array.isArray(rawProduct.options)
          ? rawProduct.options
          : Array.isArray(rawProduct.optionsJson)
            ? rawProduct.optionsJson
            : [],
        variants: Array.isArray(rawProduct.variants)
          ? rawProduct.variants.map((variant) => ({
              ...variant,
              selectedOptions: Array.isArray(variant.selectedOptions)
                ? variant.selectedOptions
                : Array.isArray(variant.selectedOptionsJson)
                  ? variant.selectedOptionsJson
                  : [],
            }))
          : [],
      };

      for (const rule of rules) {
        const result = getUpdatedProducts({
          product,
          field: rule.field,
          editType: rule.editOption,
          value: rule.value,
          searchKey: rule.searchKey,
          replaceText: rule.replaceText,
          supportValue: rule.supportValue,
          changes,
          historyId,
          shop: history.shop,
          batchId,
        });

        if (result) {
          formattedProducts.push(result);
        }
      }
    }

    return {
      formattedProducts: formattedProducts.join("\n"),
      changes,
      lastProductId,
      hasMore,
      batchId,
      batchTargetCount: orderedIds.length,
    };
  }

  async trackEditProducts({
    field,
    editType,
    editValue,
    filterParams,
    searchKey,
    replaceText,
    supportValue,
    page = 1,
    limit = 20,
    lang,
    subscription = {},
  }) {
    try {
      const changes = [];
      const isVariant = isVariantLevelField(field);
      const include = buildProductInclude([field]);

      const target = await resolveCanonicalProductTarget({
        shop: this.session.shop,
        filterParams,
        queryParams: { page, limit },
        sampleLimit: Number.parseInt(limit, 10) || 20,
        sampleInclude: include || undefined,
      });

      const productLimit = subscription?.limit || 100;
      const planName = subscription?.planName || "Free Plan";
      const isUnlimited = subscription?.isUnlimited || false;

      let subscriptionWarning = null;

      if (!isUnlimited) {
        if (target.count > productLimit) {
          subscriptionWarning = {
            type: "LIMIT_EXCEEDED",
            message: `Your current plan (${planName}) allows editing up to ${productLimit} products. You're trying to edit ${target.count} products. Please upgrade your plan or reduce the number of products.`,
          };
        } else if (target.count > productLimit * 0.8) {
          const remaining = productLimit - target.count;
          subscriptionWarning = {
            type: "APPROACHING_LIMIT",
            message: `You're editing ${target.count} products. Your plan allows ${productLimit} products per edit. ${remaining} products remaining.`,
          };
        }
      }

      const formattedProducts = [];

      for (const targetProduct of target.sampleProducts) {
        const product = {
          ...targetProduct,
          variants: Array.isArray(targetProduct.variants) ? targetProduct.variants : [],
          options: Array.isArray(targetProduct.options)
            ? targetProduct.options
            : Array.isArray(targetProduct.optionsJson)
              ? targetProduct.optionsJson
              : [],
        };

        const result = getUpdatedProducts({
          product,
          field,
          editType,
          value: editValue,
          changes,
          searchKey,
          replaceText,
          supportValue,
          isTracking: true,
        });

        if (result) {
          formattedProducts.push(result);
        }
      }

      return {
        message: "tracking successful",
        data: {
          preview: formattedProducts,
          field: FIELD_TRANSLATIONS?.[field]?.[lang] || field,
          isVariant,
          mirrorBatchId: target.mirrorBatchId,
          pagination: target.pagination,
        },
        subscription: subscriptionWarning ? { warning: subscriptionWarning } : {},
      };
    } catch (err) {
      throw err;
    }
  }
}
