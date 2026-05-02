import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import {
  uploadFileToShopifyStagedTarget,
} from "../../utils/productBulkEditUtils.js";
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
const DEFAULT_DISPATCH_PAGE_SIZE = 1000;
const DISPATCH_PRODUCT_INSERT_CHUNK_SIZE = 1000;

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

function buildPayloadHash(payload) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function makeUndoDispatchTempPath(executionId) {
  return path.join(
    os.tmpdir(),
    `bulk-undo-${executionId || crypto.randomUUID()}-${Date.now()}.jsonl`,
  );
}

function writeJsonlLine(stream, line) {
  return new Promise((resolve, reject) => {
    stream.write(`${line}\n`, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function closeJsonlStream(stream) {
  return new Promise((resolve, reject) => {
    stream.once("error", reject);
    stream.end(resolve);
  });
}

function createUndoProductFromSnapshot(snapshot) {
  return {
    shop: snapshot.shop,
    productId: snapshot.productId,
    ordinal: snapshot.ordinal,
    targetIds: [],
    productFieldChanges: [],
    variantFieldChanges: [],
    options: [],
  };
}

function addSnapshotToUndoProduct(product, snapshot) {
  product.ordinal = Math.min(product.ordinal, snapshot.ordinal);
  product.targetIds.push(snapshot.id);

  const fieldChange = {
    field: snapshot.field,
    revertValue: snapshot.previousValue,
    oldValue: snapshot.previousValue,
    currentValue: snapshot.currentValue ?? null,
    changeRecordId: snapshot.changeRecordId,
    targetHash: snapshot.targetHash,
  };

  if (snapshot.scope === "PRODUCT") {
    product.productFieldChanges.push(fieldChange);
    return product;
  }

  if (snapshot.scope === "VARIANT" && snapshot.variantId) {
    let variant = product.variantFieldChanges.find(
      (item) => item.variantId === snapshot.variantId,
    );

    if (!variant) {
      variant = {
        variantId: snapshot.variantId,
        changes: [],
      };
      product.variantFieldChanges.push(variant);
    }

    variant.changes.push(fieldChange);
  }

  return product;
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

      const now = new Date();
      await bulkUndoExecutionRepository.createExecution(
        {
          shop: this.session.shop,
          historyId,
          executionIdentity,
          source: "manual_undo",
          now,
        },
        tx,
      );

      const frozenCount = await bulkUndoExecutionRepository.freezeTargets(
        {
          shop: this.session.shop,
          historyId,
          executionIdentity,
          now,
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
          now,
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
        now: new Date(),
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

  async dispatchUndoBulkOperation({
    historyId,
    executionId,
    field = "",
    limit = DEFAULT_DISPATCH_PAGE_SIZE,
    workerId = "bulkUndoWorker",
  }) {
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
      now: new Date(),
      worker: workerId,
    });

    if (locked.count !== 1) {
      throw new Error("Undo execution is not dispatchable");
    }

    const operationName = `bulkEditUndoProducts_${Date.now()}.jsonl`;
    const tempFilePath = makeUndoDispatchTempPath(executionId);
    const stream = fs.createWriteStream(tempFilePath, { encoding: "utf8" });
    const dispatchProducts = [];
    const pageSize = Math.max(1, Number.parseInt(limit, 10) || DEFAULT_DISPATCH_PAGE_SIZE);
    const mode = this.getMutationMode(field);

    let currentProduct = null;
    let lastSnapshotOrdinal = Number(execution.lastSnapshotOrdinal || 0);
    let productCount = 0;
    let targetCount = 0;
    let streamClosed = false;

    const flushDispatchProducts = async () => {
      if (!dispatchProducts.length) return;

      const batch = dispatchProducts.splice(0, dispatchProducts.length);
      await bulkUndoExecutionRepository.createDispatchProducts({
        shop: this.session.shop,
        executionIdentity: executionId,
        products: batch,
      });
    };

    const flushProduct = async () => {
      if (!currentProduct) return;

      const targetIds = currentProduct.targetIds || [];
      const payload = this.buildProductSetPayload(currentProduct);
      currentProduct = null;

      if (!payload) return;

      const linePayload = { productSet: payload };
      await writeJsonlLine(stream, JSON.stringify(linePayload));

      productCount += 1;
      targetCount += targetIds.length;
      dispatchProducts.push({
        productId: payload.id,
        ordinal: productCount,
        targetIds,
        payloadHash: buildPayloadHash(linePayload),
      });

      if (dispatchProducts.length >= DISPATCH_PRODUCT_INSERT_CHUNK_SIZE) {
        await flushDispatchProducts();
      }
    };

    try {
      while (true) {
        const snapshotRows = await bulkUndoExecutionRepository.getNextSnapshotBatch({
          shop: this.session.shop,
          executionIdentity: executionId,
          cursorOrdinal: lastSnapshotOrdinal,
          limit: pageSize,
        });

        if (!snapshotRows.length) break;

        for (const snapshot of snapshotRows) {
          if (currentProduct && currentProduct.productId !== snapshot.productId) {
            await flushProduct();
          }

          if (!currentProduct) {
            currentProduct = createUndoProductFromSnapshot(snapshot);
          }

          addSnapshotToUndoProduct(currentProduct, snapshot);
          lastSnapshotOrdinal = snapshot.ordinal;
        }

        if (snapshotRows.length < pageSize) break;
      }

      await flushProduct();
      await flushDispatchProducts();
      await closeJsonlStream(stream);
      streamClosed = true;

      if (productCount <= 0) {
        return {
          bulkOperationId: null,
          lastProductId: null,
          lastSnapshotOrdinal,
          count: 0,
          productCount: 0,
          targetCount: 0,
          jsonlFileBytes: 0n,
        };
      }

      const { size } = await fs.promises.stat(tempFilePath);

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

      const keyUrl = await uploadFileToShopifyStagedTarget(
        target,
        tempFilePath,
        operationName,
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
        lastProductId: null,
        lastSnapshotOrdinal,
        count: productCount,
        productCount,
        targetCount,
        jsonlFileBytes: BigInt(size),
      };
    } finally {
      if (!streamClosed) {
        stream.destroy();
      }

      await fs.promises.rm(tempFilePath, { force: true }).catch(() => {});
    }
  }

  buildProductSetPayload(product) {
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

    if (Object.keys(payload).length === 1) return null;

    return payload;
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
