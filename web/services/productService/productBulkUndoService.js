import crypto from "crypto";
import { uploadToShopifyStagedTarget } from "../../utils/productBulkEditUtils.js";
import { addbulkUndoJob } from "../../Jobs/Queues/bulkUndoJob.js";
import {
  getProductSetMutation,
  PRODUCT_SET_MODE,
} from "../../helpers/productBulkOperationHelpers/mutationTemplates.js";
import { FIELD_CONFIGS } from "../../helpers/productBulkOperationHelpers/constants.js";
import { prisma } from "../../Config/database.js";
import {
  BULK_UNDO_STATES,
  buildPlannedUndoState,
  normalizeUndoState,
} from "../bulkEditExecutionStateService.js";
import { adminGraphqlWithRetry } from "../../utils/shopifyAdminApi.js";
import { logBatchEvent } from "../../utils/batchObservability.js";

const OPTION_NAME_FIELDS = new Set([
  "option1Name",
  "option2Name",
  "option3Name",
]);

class UndoEditService {
  constructor(session) {
    this.session = session;
  }

  async undoEdit({ id: historyId, shop }) {
    if (!historyId || !shop || shop !== this.session?.shop) {
      throw new Error("Undo request is not authorized for this shop");
    }

    const editedHistory = await prisma.editHistory.findFirst({
      where: {
        id: historyId,
        shop,
      },
      select: {
        id: true,
        status: true,
        undo: true,
      },
    });

    if (!editedHistory) {
      throw new Error("Edit history not found");
    }

    const undoData = normalizeUndoState(
      editedHistory.undo,
      buildPlannedUndoState({ allowed: false }),
    );

    if (editedHistory.status !== "completed" || undoData.allowed === false) {
      throw new Error("Undo can only be performed on completed edits");
    }

    if (
      [
        BULK_UNDO_STATES.QUEUED,
        BULK_UNDO_STATES.DISPATCHING,
        BULK_UNDO_STATES.AWAITING_SHOPIFY,
        BULK_UNDO_STATES.FINALIZING,
        BULK_UNDO_STATES.COMPLETED,
      ].includes(undoData.state)
    ) {
      throw new Error("Undo is already queued or completed");
    }

    const executionIdentity = undoData.executionIdentity || crypto.randomUUID();

    const updatedHistory = await prisma.editHistory.updateMany({
      where: {
        id: historyId,
        shop,
        status: "completed",
      },
      data: {
        undo: {
          ...undoData,
          status: "pending",
          state: BULK_UNDO_STATES.QUEUED,
          queuedAt: new Date(),
          startedAt: null,
          completedAt: null,
          processedCount: 0,
          durationMs: 0,
          bulkOperationId: null,
          executionIdentity,
          error: null,
        },
      },
    });

    if (!updatedHistory.count) {
      throw new Error("Undo could not be queued");
    }

    await addbulkUndoJob({
      historyId,
      shop,
      source: "manual_undo",
      executionId: executionIdentity,
    });

    return {
      data: { id: historyId },
      message: "Undo processing started",
    };
  }

  async undoEditBulkOperation(products, field = "") {
    const operationName = `bulkEditUndoProducts_${Date.now()}`;
    const formattedProducts = [];
    let lastId = null;
    let count = 0;
    let mode = PRODUCT_SET_MODE.PRODUCT_ONLY;

    if (!field || field === "mixed") {
      mode = PRODUCT_SET_MODE.BOTH;
    } else if (OPTION_NAME_FIELDS.has(field)) {
      mode = PRODUCT_SET_MODE.BOTH;
    } else if (FIELD_CONFIGS[field]?.isVariantLevel) {
      mode = PRODUCT_SET_MODE.VARIANT_ONLY;
    } else {
      mode = PRODUCT_SET_MODE.PRODUCT_ONLY;
    }

    for (const product of products) {
      const productFieldChanges = Array.isArray(product?.productFieldChanges)
        ? product.productFieldChanges
        : [];
      const variantFieldChanges = Array.isArray(product?.variantFieldChanges)
        ? product.variantFieldChanges
        : [];
      const productOptions = Array.isArray(product?.options)
        ? product.options
        : [];

      const payload = {
        id: product.productId,
      };

      if (productFieldChanges.length > 0) {
        productFieldChanges.forEach((fieldChange) => {
          if (!OPTION_NAME_FIELDS.has(fieldChange.field)) {
            Object.assign(
              payload,
              this.getProductFieldPayload(
                fieldChange.field,
                fieldChange.revertValue,
                fieldChange.oldValue,
              ),
            );
          }
        });
      }

      if (variantFieldChanges.length > 0) {
        payload.productOptions = productOptions.map((option) => ({
          name: option.name,
          values: option.values?.map((value) => ({ name: value })),
        }));

        payload.variants = variantFieldChanges.map((variant) => {
          const variantPayload = {
            id: variant.variantId,
            optionValues: (() => {
              if (Array.isArray(variant.selectedOptions) && variant.selectedOptions.length) {
                return variant.selectedOptions.map((option) => ({
                  optionName: option.name,
                  name: option.value,
                }));
              }

              return productOptions
                .map((option, index) => {
                  const value = variant[`option${index + 1}Value`] ?? variant[`option${index + 1}`];
                  if (!value) return null;
                  return {
                    optionName: option.name,
                    name: value,
                  };
                })
                .filter(Boolean);
            })(),
          };

          const changePayload =
            variant.changes?.reduce((accumulator, fieldChange) => {
              accumulator[fieldChange.field] =
                fieldChange.revertValue ?? fieldChange.oldValue;
              return accumulator;
            }, {}) || {};

          if (["option1Values", "option2Values", "option3Values"].includes(field)) {
            return variantPayload;
          }

          return { ...variantPayload, ...changePayload };
        });
      }

      formattedProducts.push(JSON.stringify({ productSet: payload }));
      lastId = product?.id;
      count += 1;
    }

    const stagedRes = await adminGraphqlWithRetry({
      session: this.session,
      shop: this.session?.shop,
      operationName: "bulkUndoStagedUploadsCreate",
      data: {
        query: `
          mutation stagedUploadsCreate {
            stagedUploadsCreate(input: [
              {
                filename: "${operationName}",
                mimeType: "text/jsonl",
                resource: BULK_MUTATION_VARIABLES,
                httpMethod: POST
              }
            ]) {
              stagedTargets {
                url
                resourceUrl
                parameters { name value }
              }
              userErrors { field message }
            }
          }
        `,
      },
    });

    const ndjson = formattedProducts.join("\n");
    const userErrors = stagedRes?.body?.data?.stagedUploadsCreate?.userErrors;
    if (userErrors?.length) {
      throw new Error(`Shopify API returned errors: ${JSON.stringify(userErrors)}`);
    }

    const target = stagedRes?.body?.data?.stagedUploadsCreate?.stagedTargets?.[0];
    if (!target) {
      throw new Error("Failed to get staged upload target from Shopify");
    }

    const keyUrl = await uploadToShopifyStagedTarget(target, ndjson);

    const bulkRes = await adminGraphqlWithRetry({
      session: this.session,
      shop: this.session?.shop,
      operationName: "bulkUndoRunMutation",
      data: {
        query: `
          mutation {
            bulkOperationRunMutation(
              mutation: ${JSON.stringify(getProductSetMutation(mode))},
              stagedUploadPath: "${keyUrl}"
            ) {
              bulkOperation { id status }
              userErrors { field message }
            }
          }
        `,
      },
    });

    const bulkErrors = bulkRes?.body?.data?.bulkOperationRunMutation?.userErrors;
    if (bulkErrors?.length) {
      throw new Error(`Bulk operation returned errors: ${JSON.stringify(bulkErrors)}`);
    }

    const result = bulkRes.body?.data?.bulkOperationRunMutation;
    logBatchEvent("catalog_batch_edit_execution", {
      shop: this.session?.shop,
      bulkOperationId: result?.bulkOperation?.id,
      path: "undo",
      extra: {
        field,
        targetCount: count,
      },
    });

    return {
      bulkOperationId: result?.bulkOperation?.id,
      lastProductId: lastId,
      count,
    };
  }

  getProductFieldPayload(field, revertValue, oldValue) {
    const value = revertValue ?? oldValue;

    const fieldMap = {
      description: { descriptionHtml: value },
      "Meta Title": {
        seo: { title: value },
      },
      "Meta Description": {
        seo: { description: value },
      },
    };

    return fieldMap[field] || { [field]: value };
  }
}

export default UndoEditService;
