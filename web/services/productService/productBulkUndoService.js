import crypto from "crypto";
import { uploadToShopifyStagedTarget } from "../../utils/productBulkEditUtils.js";
import { addBulkUndoJob } from "../../Jobs/Queues/bulkUndoJob.js";
import {
  bulkOperationMutation,
  getProductSetMutation,
  PRODUCT_SET_MODE,
  stagesUploadMutation,
} from "../../helpers/productBulkOperationHelpers/mutationTemplates.js";
import shopify from "../../shopify.js";
import { clearKeyCachesBatch } from "../../utils/cacheUtils.js";
import { FIELD_CONFIGS } from "../../helpers/productBulkOperationHelpers/constants.js";
import { prisma } from "../../config/database.js";
import { bulkUndoExecutionRepository } from "../../repositories/bulkUndoExecutionRepository.js";
import {
  BULK_UNDO_STATES,
  normalizeUndoState,
} from "../bulkEditExecutionStateService.js";

const OPTION_NAME_FIELDS = new Set([
  "option1Name",
  "option2Name",
  "option3Name",
]);

const OPTION_VALUE_FIELDS = new Set([
  "option1Values",
  "option2Values",
  "option3Values",
]);

const BLOCKED_UNDO_STATES = [
  BULK_UNDO_STATES.QUEUED,
  BULK_UNDO_STATES.DISPATCHING,
  BULK_UNDO_STATES.AWAITING_SHOPIFY,
  BULK_UNDO_STATES.FINALIZING,
  BULK_UNDO_STATES.COMPLETED,
];

function getUndoCacheKeys(shop, historyId) {
  return [
    `${shop}:fetchHistories`,
    `${shop}:historyDetails:${historyId}`,
  ];
}

function normalizeBooleanUndoValue(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", ""].includes(normalized)) {
      return false;
    }
  }

  return Boolean(value);
}

class UndoEditService {
  constructor(session) {
    this.client = new shopify.api.clients.Graphql({ session });
    this.session = session;
  }

  async undoEdit(historyId) {
    const { executionIdentity } = await prisma.$transaction(async (tx) => {
      const editedHistory = await tx.editHistory.findFirst({
        where: {
          id: historyId,
          shop: this.session.shop,
        },
        select: {
          id: true,
          status: true,
          undo: true,
          undoState: true,
          undoExecutionIdentity: true,
        },
      });

      if (!editedHistory) {
        throw new Error("Edit history not found");
      }

      if (!editedHistory.undo) {
        throw new Error("Undo metadata missing - cannot safely undo");
      }

      const undoData = normalizeUndoState(editedHistory.undo);

      if (undoData.allowed !== true) {
        throw new Error("Undo not allowed for this edit");
      }

      if (editedHistory.status !== "completed") {
        throw new Error("Undo only allowed on completed edits");
      }

      const currentState =
        editedHistory.undoState ?? undoData.state ?? BULK_UNDO_STATES.PLANNED;

      if (BLOCKED_UNDO_STATES.includes(currentState)) {
        throw new Error("Undo already in progress or completed");
      }

      const executionIdentity = crypto.randomUUID();

      const nextUndo = {
        ...undoData,
        state: BULK_UNDO_STATES.QUEUED,
        status: "pending",
        queuedAt: new Date(),
        startedAt: null,
        completedAt: null,
        processedCount: 0,
        durationMs: 0,
        bulkOperationId: null,
        executionIdentity,
        error: null,
      };

      const updated = await tx.editHistory.updateMany({
        where: {
          id: historyId,
          shop: this.session.shop,
          status: "completed",
          undoState: {
            in: [null, BULK_UNDO_STATES.PLANNED, BULK_UNDO_STATES.FAILED],
          },
        },
        data: {
          undoState: BULK_UNDO_STATES.QUEUED,
          undoExecutionIdentity: executionIdentity,
          undoQueuedAt: new Date(),
          undo: nextUndo,
        },
      });

      if (updated.count !== 1) {
        throw new Error("Undo could not be queued");
      }

      await bulkUndoExecutionRepository.createExecution(
        {
          shop: this.session.shop,
          historyId,
          executionIdentity,
          source: "manual_undo",
        },
        tx,
      );

      const frozenCount = await bulkUndoExecutionRepository.freezeTargets(
        {
          shop: this.session.shop,
          historyId,
          executionIdentity,
        },
        tx,
      );

      if (frozenCount <= 0) {
        throw new Error("Undo cannot be queued because no reversible targets exist");
      }

      await bulkUndoExecutionRepository.markFrozen(
        {
          shop: this.session.shop,
          executionIdentity,
          frozenCount,
        },
        tx,
      );

      return {
        executionIdentity,
      };
    });

    try {
      await addBulkUndoJob(
        {
          historyId,
          shop: this.session.shop,
          source: "manual_undo",
          executionId: executionIdentity,
        },
        {
          jobId: `bulk-undo:${this.session.shop}:${historyId}:${executionIdentity}`,
        },
      );
    } catch (err) {
      await bulkUndoExecutionRepository.markFailed({
        shop: this.session.shop,
        executionIdentity,
        errorMessage: `Undo enqueue failed: ${err.message}`,
      });

      await clearKeyCachesBatch(getUndoCacheKeys(this.session.shop, historyId));

      throw err;
    }

    await clearKeyCachesBatch(getUndoCacheKeys(this.session.shop, historyId));

    return {
      data: { id: historyId },
      message: "Undo processing started",
    };
  }

  async prepareUndoBatch({ historyId, executionId, limit = 75 }) {
    const execution = await bulkUndoExecutionRepository.findExecution({
      shop: this.session.shop,
      executionIdentity: executionId,
    });

    if (!execution) {
      throw new Error("Undo execution not found");
    }

    if (execution.historyId !== historyId) {
      throw new Error("Undo execution/history mismatch");
    }

    const locked = await bulkUndoExecutionRepository.markDispatching({
      shop: this.session.shop,
      executionIdentity: executionId,
    });

    if (locked.count !== 1) {
      throw new Error("Undo execution is not dispatchable");
    }

    const snapshotRows = await bulkUndoExecutionRepository.getNextSnapshotBatch({
      shop: this.session.shop,
      executionIdentity: executionId,
      cursorOrdinal: execution.lastSnapshotOrdinal,
      limit,
    });

    if (!snapshotRows.length) {
      return {
        products: [],
        hasMore: false,
        lastSnapshotOrdinal: execution.lastSnapshotOrdinal || 0,
        count: 0,
      };
    }

    const productIds = snapshotRows.map((row) => row.productId);

    const changes = await prisma.changeRecord.findMany({
      where: {
        shop: this.session.shop,
        editHistoryId: historyId,
        productId: { in: productIds },
      },
      orderBy: [
        { productId: "asc" },
        { id: "asc" },
      ],
    });

    const grouped = new Map();

    for (const change of changes) {
      const product = grouped.get(change.productId) || {
        shop: change.shop,
        productId: change.productId,
        productFieldChanges: [],
        variantFieldChanges: [],
        options: Array.isArray(change.options) ? change.options : [],
      };

      const productFieldChanges = Array.isArray(change.productFieldChanges)
        ? change.productFieldChanges
        : [];
      const variantFieldChanges = Array.isArray(change.variantFieldChanges)
        ? change.variantFieldChanges
        : [];

      product.productFieldChanges.push(...productFieldChanges);
      product.variantFieldChanges.push(...variantFieldChanges);

      if (!product.options.length && Array.isArray(change.options)) {
        product.options = change.options;
      }

      grouped.set(change.productId, product);
    }

    return {
      products: productIds.map((productId) => grouped.get(productId)).filter(Boolean),
      hasMore: snapshotRows.length === limit,
      lastSnapshotOrdinal: snapshotRows.at(-1)?.ordinal ?? execution.lastSnapshotOrdinal ?? 0,
      count: snapshotRows.length,
    };
  }

  async undoEditBulkOperation(products, field = "") {
    const operationName = `bulkEditUndoProducts_${Date.now()}`;
    const formattedProducts = [];

    let lastProductId = null;
    let count = 0;

    const mode = this.getMutationMode(field);

    for (const product of products) {
      if (!product?.shop || product.shop !== this.session.shop) {
        throw new Error("Cross-tenant product detected in undo payload");
      }

      if (!product?.productId) {
        throw new Error("Missing productId in undo payload");
      }

      const payload = { id: product.productId };

      const productFieldChanges = product.productFieldChanges || [];
      const variantFieldChanges = product.variantFieldChanges || [];
      const productOptions = product.options || [];

      const revertedOptionNames = new Map();

      for (const fieldChange of productFieldChanges) {
        if (OPTION_NAME_FIELDS.has(fieldChange.field)) {
          const index = Number(
            fieldChange.field.match(/^option([123])Name$/)?.[1],
          );
          if (index) {
            revertedOptionNames.set(
              index - 1,
              fieldChange.revertValue ?? fieldChange.oldValue,
            );
          }
          continue;
        }

        Object.assign(
          payload,
          this.getProductFieldPayload(
            fieldChange.field,
            fieldChange.revertValue,
            fieldChange.oldValue,
          ),
        );
      }

      if (revertedOptionNames.size > 0 || variantFieldChanges.length > 0) {
        payload.productOptions = productOptions.map((option, index) => ({
          name: revertedOptionNames.get(index) ?? option.name,
          values: option.values?.map((v) => ({ name: v })) || [],
        }));
      }

      if (variantFieldChanges.length > 0) {
        payload.variants = variantFieldChanges.map((variant) => ({
          id: variant.variantId,
          ...this.getVariantOptionValues(variant, productOptions),
          ...this.getVariantFieldPayloadFromChanges(variant),
        }));
      }

      if (Object.keys(payload).length === 1) continue;

      formattedProducts.push(JSON.stringify({ productSet: payload }));
      lastProductId = product.productId;
      count++;
    }

    if (!formattedProducts.length) {
      return { bulkOperationId: null, lastProductId: null, count: 0 };
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

    const stagedErrors =
      stagedRes?.body?.data?.stagedUploadsCreate?.userErrors || [];
    if (stagedErrors.length) {
      throw new Error(
        `Shopify staged upload returned errors: ${JSON.stringify(stagedErrors)}`,
      );
    }

    const target =
      stagedRes?.body?.data?.stagedUploadsCreate?.stagedTargets?.[0];

    if (!target) {
      throw new Error("Failed to get staged upload target");
    }

    const keyUrl = await uploadToShopifyStagedTarget(
      target,
      formattedProducts.join("\n"),
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
      bulkRes?.body?.data?.bulkOperationRunMutation?.userErrors || [];
    if (bulkErrors.length) {
      throw new Error(
        `Shopify bulk undo returned errors: ${JSON.stringify(bulkErrors)}`,
      );
    }

    return {
      bulkOperationId:
        bulkRes.body?.data?.bulkOperationRunMutation?.bulkOperation?.id ??
        null,
      lastProductId,
      count,
    };
  }

  getProductFieldPayload(field, revertValue, oldValue) {
    const value = revertValue ?? oldValue;

    const fieldMap = {
      title: { title: value ?? "" },
      vendor: { vendor: value ?? "" },
      productType: { productType: value ?? "" },
      description: { descriptionHtml: value ?? "" },
      descriptionHtml: { descriptionHtml: value ?? "" },
      metaTitle: { seo: { title: value ?? "" } },
      metaDescription: { seo: { description: value ?? "" } },
      handle: { handle: value ?? "" },
      status: { status: value },
      tags: { tags: Array.isArray(value) ? value : [] },
    };

    return fieldMap[field] || {};
  }

  getVariantFieldPayloadFromChanges(variant) {
    const payload = {};

    for (const change of variant.changes || []) {
      Object.assign(
        payload,
        this.getVariantFieldPayload(
          change.field,
          change.revertValue,
          change.oldValue,
        ),
      );
    }

    return payload;
  }

  getVariantOptionValues(variant, productOptions = []) {
    if (Array.isArray(variant?.selectedOptions) && variant.selectedOptions.length > 0) {
      return {
        optionValues: variant.selectedOptions.map((option) => ({
          optionName: option.name,
          name: option.value,
        })),
      };
    }

    const optionValues = productOptions
      .map((option, index) => {
        const value = variant?.[`option${index + 1}Value`] ?? variant?.[`option${index + 1}`];
        if (!option?.name || !value) return null;

        return {
          optionName: option.name,
          name: value,
        };
      })
      .filter(Boolean);

    return optionValues.length ? { optionValues } : {};
  }

  getVariantFieldPayload(field, revertValue, oldValue) {
    const value = revertValue ?? oldValue;

    const fieldMap = {
      price: { price: value },
      compareAtPrice: { compareAtPrice: value },
      sku: { sku: value ?? "" },
      barcode: { barcode: value ?? "" },
      taxable: { taxable: normalizeBooleanUndoValue(value) },
      inventoryPolicy: { inventoryPolicy: value },
      requiresShipping: { requiresShipping: normalizeBooleanUndoValue(value) },
      weight: { weight: value },
      weightUnit: { weightUnit: value },
      cost: { inventoryItem: { cost: value } },
    };

    return fieldMap[field] || {};
  }

  getMutationMode(field = "") {
    if (!field || field === "mixed") return PRODUCT_SET_MODE.BOTH;
    if (OPTION_NAME_FIELDS.has(field)) return PRODUCT_SET_MODE.BOTH;
    if (OPTION_VALUE_FIELDS.has(field)) return PRODUCT_SET_MODE.BOTH;
    if (FIELD_CONFIGS[field]?.isVariantLevel)
      return PRODUCT_SET_MODE.VARIANT_ONLY;

    return PRODUCT_SET_MODE.PRODUCT_ONLY;
  }
}

export default UndoEditService;
