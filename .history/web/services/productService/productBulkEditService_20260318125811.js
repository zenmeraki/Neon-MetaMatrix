// web/services/productBulkUpdateServices/ProductBulkService.js
import shopify from "../../shopify.js";
import { uploadToShopifyStagedTarget } from "../../utils/productBulkEditUtils.js";
import {
  bulkOperationMutation,
  getProductSetMutation,
  PRODUCT_SET_MODE,
  stagesUploadMutation,
} from "../../helpers/productBulkOperationHelpers/mutationTemplates.js";
import { Services } from "../../services/productService/productFilterService.js";
import crypto from "crypto";
import { getUpdatedProducts } from "../../helpers/productBulkOperationHelpers/productUpdateHandler.js";
import { addbulkEditJob } from "../../Jobs/Queues/bulkEditJob.js";
import CacheService from "../../utils/cacheService.js";
import { createMultiLanguage } from "../../utils/googleTranslator.js";
import { FIELD_TRANSLATIONS } from "../../Config/constants.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { FIELD_CONFIGS } from "../../helpers/productBulkOperationHelpers/constants.js";
import { prisma } from "../../config/database.js";

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

function buildProductInclude(field) {
  if (isVariantLevelField(field) || OPTION_NAME_FIELDS.has(field)) {
    return {
      variants: true,
    };
  }

  return undefined;
}

export default class ProductBulkService {
  constructor(session) {
    this.client = new shopify.api.clients.Graphql({ session });
    this.session = session;
  }

  async bulkEditProducts(req) {
    try {
      const result = await this._bulkOperationEdit(
        req.body,
        req.subscription || {},
      );

      const history = await prisma.editHistory.create({
        data: result,
      });

      await clearKeyCaches(`${history.shop}:fetchHistories`);

      await addbulkEditJob({
        historyId: history.id,
        session: this.session,
      });

      return history;
    } catch (error) {
      throw new Error(error.message);
    }
  }

  async _bulkOperationEdit(body, subscription) {
    try {
      const {
        editedType,
        editedField,
        filterParams,
        value,
        searchKey,
        replaceText,
        supportValue,
      } = body;

      if (editedField === "inventory" && !body.locationId) {
        throw new Error("Location ID is required for inventory edits");
      }

      const productService = new Services();

      const where = productService.getProductPrismaWhere(
        filterParams,
        this.session.shop,
      );

      const count = await prisma.product.count({ where });

      const limit = subscription?.limit || 100;
      const planName = subscription?.planName || "Free Plan";
      const isUnlimited = subscription?.isUnlimited || false;

      if (!isUnlimited && count > limit) {
        throw new Error(
          `Your current plan (${planName}) allows editing up to ${limit} products at a time. You are trying to edit ${count} products. Please upgrade your plan or reduce the number of products.`,
        );
      }

      const updatedTitle = getUpdatedProducts({
        field: editedField,
        editType: editedType,
        value,
        supportValue,
        searchKey,
        replaceText,
        returnTitleOnly: true,
      });

      const multiLanguageTitle = await createMultiLanguage(updatedTitle);

      return {
        shop: this.session.shop,
        title: multiLanguageTitle,
        queryFilter: JSON.stringify(where),
        rules: [
          {
            field: editedField,
            value,
            editOption: editedType,
            searchKey,
            replaceText,
            supportValue,
          },
        ],
        startedAt: new Date(),
        status: "pending",
        processedCount: 0,
        totalItems: count,
        durationMs: 0,
        ...(editedField === "inventory" && { locationId: body.locationId }),
        undo: {
          allowed: editedField === "deleteProducts" ? false : true,
        },
      };
    } catch (error) {
      throw new Error(error.message);
    }
  }

  async _bulkOperationHelper({ formattedProducts, field }) {
    try {
      const operationName = `bulkEditProducts_${Date.now()}`;
      let mode = PRODUCT_SET_MODE.PRODUCT_ONLY;

      if (field === "deleteProducts") {
        mode = PRODUCT_SET_MODE.PRODUCT_DELETE;
      }

      if (OPTION_NAME_FIELDS.has(field)) {
        mode = PRODUCT_SET_MODE.BOTH;
      } else if (FIELD_CONFIGS[field]?.isVariantLevel || isVariantLevelField(field)) {
        mode = PRODUCT_SET_MODE.VARIANT_ONLY;
      }

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
      throw new Error(err.message);
    }
  }

async _preparingBulkOperation({ historyId }) {
  try {
    const history = await prisma.editHistory.findUnique({
      where: { id: historyId },
      select: {
        queryFilter: true,
        batch: true,
        rules: true,
      },
    });

    if (!history) {
      throw new Error("Edit history not found");
    }

    const rule = Array.isArray(history.rules) ? history.rules[0] : null;
    if (!rule) {
      throw new Error("Edit rule not found");
    }

    const baseWhere = JSON.parse(history.queryFilter || "{}");
    const limit = history.batch?.size || 75;

    const where = { ...baseWhere };

    if (history.batch?.lastProductId) {
      where.id = {
        ...(typeof where.id === "object" && where.id !== null ? where.id : {}),
        gt: history.batch.lastProductId,
      };
    }

 const include =
  OPTION_NAME_FIELDS.has(rule.field) ||
  FIELD_CONFIGS?.[rule.field]?.isVariantLevel ||
  VARIANT_LEVEL_FIELDS.has(rule.field)          // ← add this line
    ? { variants: true }
    : undefined;

    const products = await prisma.product.findMany({
      where,
      ...(include ? { include } : {}),
      orderBy: { id: "asc" },
      take: limit,
    });

    const changes = [];
    const formattedProducts = [];
    let lastId = null;
    let count = 0;
    const batchId = crypto.randomUUID();

    for (const rawProduct of products) {
      const product = {
        ...rawProduct,
        variants: Array.isArray(rawProduct.variants) ? rawProduct.variants : [],
      };

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
        shop: this.session.shop,
        batchId,
      });

      if (result) {
        formattedProducts.push(result);
      }

      lastId = product.id;
      count++;
    }

    return {
      formattedProducts: formattedProducts.join("\n"),
      changes,
      lastProductId: lastId,
      hasMore: count === limit,
      batchId,
    };
  } catch (err) {
    throw err;
  }
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

      const productService = new Services();

      const where = productService.getProductPrismaWhere(
        filterParams,
        this.session.shop,
      );

      const currentPage = Number.parseInt(page, 10) || 1;
      const perPage = Number.parseInt(limit, 10) || 20;
      const skip = (currentPage - 1) * perPage;

      const include = buildProductInclude(field);

      const products = await prisma.product.findMany({
        where,
         ...(include ? { include } : {}),
        orderBy: { createdAt: "desc" },
        skip,
        take: perPage,
      });

      const count = await prisma.product.count({ where });

      const productLimit = subscription?.limit || 100;
      const planName = subscription?.planName || "Free Plan";
      const isUnlimited = subscription?.isUnlimited || false;

      let subscriptionWarning = null;

      if (!isUnlimited) {
        if (count > productLimit) {
          subscriptionWarning = {
            type: "LIMIT_EXCEEDED",
            message: `Your current plan (${planName}) allows editing up to ${productLimit} products. You're trying to edit ${count} products. Please upgrade your plan or reduce the number of products.`,
          };
        } else if (count > productLimit * 0.8) {
          const remaining = productLimit - count;
          subscriptionWarning = {
            type: "APPROACHING_LIMIT",
            message: `You're editing ${count} products. Your plan allows ${productLimit} products per edit. ${remaining} products remaining.`,
          };
        }
      }

      const formattedProducts = [];

    for (const rawProduct of products) {
const product = {
  ...rawProduct,
  variants: Array.isArray(rawProduct.variants) ? rawProduct.variants : [],
  options: Array.isArray(rawProduct.options)
    ? rawProduct.options
    : Array.isArray(rawProduct.optionsJson)
    ? rawProduct.optionsJson
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
console.log("🧪 formattedProducts ARRAY count:", formattedProducts.length);
console.log(
  "🧪 formattedProducts ARRAY sample:",
  JSON.stringify(formattedProducts.slice(0, 2), null, 2),
);
      return {
        message: "tracking successful",
        data: {
          preview: formattedProducts,
          field: FIELD_TRANSLATIONS?.[field]?.[lang] || field,
          isVariant,
          pagination: {
            total: count,
            page: currentPage,
            limit: perPage,
            totalPages: Math.ceil(count / perPage),
            hasNextPage: skip + perPage < count,
            hasPrevPage: currentPage > 1,
          },
        },
        subscription: subscriptionWarning ? { warning: subscriptionWarning } : {},
      };
    } catch (err) {
      console.error("trackEditProducts error:", err);
      throw new Error(err.message || "Failed to track edit products");
    }
  }
}
