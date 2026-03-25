import { uploadToShopifyStagedTarget } from "../../utils/productBulkEditUtils.js";
import { addbulkUndoJob } from "../../Jobs/Queues/bulkUndoJob.js";
import {
  getProductSetMutation,
  INVENTORY_ADJUST_MUTATION,
  PRODUCT_SET_MODE,
  PRODUCT_SET_MUTATION,
} from "../../helpers/productBulkOperationHelpers/mutationTemplates.js";
import shopify from "../../shopify.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { FIELD_CONFIGS } from "../../helpers/productBulkOperationHelpers/constants.js";
import { prisma } from "../../config/database.js";

const OPTION_NAME_FIELDS = new Set([
  "option1Name",
  "option2Name",
  "option3Name",
]);

class UndoEditService {
  constructor(session) {
    this.client = new shopify.api.clients.Graphql({ session });
    this.session = session;
    this.errors = [];
    this.changes = [];
  }

  async undoEdit(historyId) {
    // ✅ CONVERTED TO PRISMA
    const editedHistory = await prisma.editHistory.findUnique({
      where: { id: historyId },
      select: { 
        status: true, 
        undo: true 
      },
    });

    if (!editedHistory) {
      throw new Error("Edit history not found");
    }

    // Handle undo field which is JSON in Prisma
    const undoData = editedHistory.undo || {};
    
    if (editedHistory.status !== "completed" && undoData.allowed === false) {
      throw new Error("Undo can only be performed on completed edits");
    }

    // ✅ CONVERTED TO PRISMA
    const updatedHistory = await prisma.editHistory.update({
      where: { id: historyId },
      data: {
        undo: {
          ...undoData,
          status: "pending",
          durationMs: 0,
          processedCount: 0,
          startedAt: new Date(),
        },
      },
      select: { id: true },
    });

    await clearKeyCaches(`${this.session.shop}:fetchHistories`);
    await clearKeyCaches(`${this.session.shop}:historyDetails:${historyId}`);
    
    await addbulkUndoJob({
      historyId,
      shop: this.session.shop,
    });

    return {
      data: updatedHistory,
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
  mode = PRODUCT_SET_MODE.BOTH;        // ✅ includes both product + variants in response
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
        productFieldChanges.forEach((fld) => {
          if (
            !["option1Name", "option2Name", "option3Name"].includes(fld.field)
          ) {
            const fieldPayload = this.getProductFieldPayload(
              fld.field,
              fld.revertValue,
              fld.oldValue
            );

            // 🔥 merge safely into main payload
            Object.assign(payload, fieldPayload);
          }
        });
      }

      if (variantFieldChanges.length > 0) {
        payload.productOptions = productOptions.map((op) => ({
          name: op.name,
          values: op.values?.map((val) => ({ name: val })),
        }));
        
        payload.variants = variantFieldChanges.map((variant) => {
          const variantPayload = {
            id: variant.variantId,
            optionValues: (() => {
  // selectedOptions stored directly (regular bulk edits)
  if (Array.isArray(variant.selectedOptions) && variant.selectedOptions.length) {
    return variant.selectedOptions.map((op) => ({
      optionName: op.name,
      name: op.value,
    }));
  }
  // Fallback for CSV imports — reconstruct from product.options + variant index
  const opts = productOptions;
  return opts
    .map((op, i) => {
      const val = variant[`option${i + 1}Value`] ?? variant[`option${i + 1}`];
      if (!val) return null;
      return { optionName: op.name, name: val };
    })
    .filter(Boolean);
})(),
          };
          
          const changePayload =
            variant.changes?.reduce((acc, fld) => {
              acc[fld.field] = fld.revertValue || fld.oldValue;
              return acc;
            }, {}) || {};

          if (
            ["option1Values", "option2Values", "option3Values"].includes(
              field
            )
          ) {
            return variantPayload;
          } else {
            return { ...variantPayload, ...changePayload };
          }
        });
      }

      formattedProducts.push(JSON.stringify({ productSet: payload }));
      
      // Note: In Prisma, _id becomes just 'id'
      lastId = product?.id;
      count++;
    }

    const stagedRes = await this.client.query({
      data: {
        query: `
            mutation stagedUploadsCreate {
              stagedUploadsCreate(input: [
                { filename: "${operationName}", mimeType: "text/jsonl", resource: BULK_MUTATION_VARIABLES, httpMethod: POST }
              ]) {
                stagedTargets {
                  url resourceUrl parameters { name value }
                }
                userErrors { field message }
              }
            }
          `,
      },
    });

    const ndjson = formattedProducts.join("\n");
    const userErrors = stagedRes?.body?.data?.stagedUploadsCreate?.userErrors;
    
    if (userErrors && userErrors.length > 0) {
      throw new Error(
        `Shopify API returned errors: ${JSON.stringify(userErrors)}`
      );
    }

    const target =
      stagedRes?.body?.data?.stagedUploadsCreate?.stagedTargets?.[0];
    if (!target) {
      throw new Error("Failed to get staged upload target from Shopify");
    }

    const keyUrl = await uploadToShopifyStagedTarget(target, ndjson);
    
    const bulkRes = await this.client.query({
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

    const bulkErrors =
      bulkRes?.body?.data?.bulkOperationRunMutation?.userErrors;
    if (bulkErrors && bulkErrors.length > 0) {
      throw new Error(
        `Bulk operation returned errors: ${JSON.stringify(bulkErrors)}`
      );
    }

    const result = bulkRes.body?.data?.bulkOperationRunMutation;

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
        seo: {
          title: value,
        },
      },
      "Meta Description": {
        seo: {
          description: value,
        },
      },
    };

    return fieldMap[field] || { [field]: value };
  }
}

export default UndoEditService;
