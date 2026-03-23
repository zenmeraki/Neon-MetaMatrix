// helpers/webhookHelpers/bulkOperations/bulkEdit.js

import axios from "axios";
import shopify from "../../../shopify.js";
import {
  getSession,
  getShopOwnerEmailAddress,
} from "../../../utils/sessionHandler.js";
import { productEditConfirmationEmailHTML } from "../../../Config/templates/productEditConfirmationTemplate.js";
import { sendEmail } from "../../../utils/emailHelper.js";
import { addbulkUndoJob } from "../../../Jobs/Queues/bulkUndoJob.js";
import { addbulkEditJob } from "../../../Jobs/Queues/bulkEditJob.js";
import { clearKeyCaches } from "../../../utils/cacheUtils.js";
import { prisma } from "../../../config/database.js";

/* ────────────────────────────────────────────────────────────── */
/*  HELPERS                                                      */
/* ────────────────────────────────────────────────────────────── */

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasValue(value) {
  return value !== undefined && value !== null;
}

function preferIncomingOrExisting(incoming, existing) {
  return hasValue(incoming) ? incoming : existing;
}

function preferNonEmptyStringOrExisting(incoming, existing) {
  if (typeof incoming === "string") {
    return incoming.trim() === "" ? existing : incoming;
  }
  return hasValue(incoming) ? incoming : existing;
}

function toNullableFloat(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toNullableInt(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isInteger(num) ? num : null;
}

function toNullableBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value == null || value === "") return null;
  return Boolean(value);
}

function calculateDurationMs(startedAt, completedAt = new Date()) {
  return Math.max(
    new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    0,
  );
}

function mergeProductForBulkMirror(existing, incoming) {
  return {
    shop: existing?.shop ?? incoming.shop,
    id: existing?.id ?? incoming.id,

    title: preferNonEmptyStringOrExisting(incoming.title, existing?.title ?? ""),
    handle: preferIncomingOrExisting(incoming.handle, existing?.handle ?? null),
    status: preferIncomingOrExisting(incoming.status, existing?.status ?? "ACTIVE"),
    productType: preferIncomingOrExisting(
      incoming.productType,
      existing?.productType ?? null,
    ),
    vendor: preferIncomingOrExisting(incoming.vendor, existing?.vendor ?? null),
    tags: Array.isArray(incoming.tags)
      ? incoming.tags
      : Array.isArray(existing?.tags)
        ? existing.tags
        : [],
    templateSuffix: preferIncomingOrExisting(
      incoming.templateSuffix,
      existing?.templateSuffix ?? null,
    ),
    description: preferIncomingOrExisting(
      incoming.description,
      existing?.description ?? null,
    ),
    createdAt: preferIncomingOrExisting(
      incoming.createdAt,
      existing?.createdAt ?? null,
    ),
    updatedAt: preferIncomingOrExisting(
      incoming.updatedAt,
      existing?.updatedAt ?? null,
    ),
    publishedAt: preferIncomingOrExisting(
      incoming.publishedAt,
      existing?.publishedAt ?? null,
    ),
    seoTitle: preferIncomingOrExisting(incoming.seoTitle, existing?.seoTitle ?? null),
    seoDescription: preferIncomingOrExisting(
      incoming.seoDescription,
      existing?.seoDescription ?? null,
    ),
    totalInventory: preferIncomingOrExisting(
      incoming.totalInventory,
      existing?.totalInventory ?? null,
    ),
    categoryId: preferIncomingOrExisting(
      incoming.categoryId,
      existing?.categoryId ?? null,
    ),
    categoryName: preferIncomingOrExisting(
      incoming.categoryName,
      existing?.categoryName ?? null,
    ),
    featuredImageUrl: preferIncomingOrExisting(
      incoming.featuredImageUrl,
      existing?.featuredImageUrl ?? null,
    ),
    featuredImageAltText: preferIncomingOrExisting(
      incoming.featuredImageAltText,
      existing?.featuredImageAltText ?? null,
    ),
    optionsJson: preferIncomingOrExisting(
      incoming.optionsJson,
      existing?.optionsJson ?? null,
    ),
    collectionsJson: preferIncomingOrExisting(
      incoming.collectionsJson,
      existing?.collectionsJson ?? null,
    ),
    option1Name: preferIncomingOrExisting(
      incoming.option1Name,
      existing?.option1Name ?? null,
    ),
    option2Name: preferIncomingOrExisting(
      incoming.option2Name,
      existing?.option2Name ?? null,
    ),
    option3Name: preferIncomingOrExisting(
      incoming.option3Name,
      existing?.option3Name ?? null,
    ),
    variantCount: preferIncomingOrExisting(
      incoming.variantCount,
      existing?.variantCount ?? null,
    ),
    visibleOnlineStore: preferIncomingOrExisting(
      incoming.visibleOnlineStore,
      existing?.visibleOnlineStore ?? null,
    ),
  };
}

/* ────────────────────────────────────────────────────────────── */
/*  PRISMA WRITE MAPPERS                                         */
/* ────────────────────────────────────────────────────────────── */

function toVariantNestedCreateInput(variant) {
  return {
    id: String(variant.id),
    title: variant.title ?? null,
    sku: variant.sku ?? null,
    barcode: variant.barcode ?? null,
    price: toNullableFloat(variant.price),
    compareAtPrice: toNullableFloat(variant.compareAtPrice),
    inventoryQuantity: toNullableInt(variant.inventoryQuantity),
    inventoryPolicy: variant.inventoryPolicy ?? null,
    taxable: toNullableBoolean(variant.taxable),
    taxCode: variant.taxCode ?? null,
    position: toNullableInt(variant.position),
    selectedOptionsJson: variant.selectedOptionsJson ?? null,
    cost: toNullableFloat(variant.cost),
    countryOfOrigin: variant.countryOfOrigin ?? null,
    hsTariffCode: variant.hsTariffCode ?? null,
    weight: toNullableFloat(variant.weight),
    weightUnit: variant.weightUnit ?? null,
    option1Value: variant.option1Value ?? null,
    option2Value: variant.option2Value ?? null,
    option3Value: variant.option3Value ?? null,
    physicalProduct: toNullableBoolean(variant.physicalProduct),
    profitMargin: toNullableFloat(variant.profitMargin),
    tracked: toNullableBoolean(variant.tracked),
  };
}

function toProductCreateInput(product, variants) {
  return {
    shop: String(product.shop),
    id: String(product.id),
    title: product.title ?? "",
    handle: product.handle ?? null,
    status: product.status ?? "ACTIVE",
    productType: product.productType ?? null,
    vendor: product.vendor ?? null,
    tags: asArray(product.tags),
    templateSuffix: product.templateSuffix ?? null,
    description: product.description ?? null,
    createdAt: product.createdAt ?? null,
    updatedAt: product.updatedAt ?? null,
    publishedAt: product.publishedAt ?? null,
    seoTitle: product.seoTitle ?? null,
    seoDescription: product.seoDescription ?? null,
    totalInventory: toNullableInt(product.totalInventory),
    categoryId: product.categoryId ?? null,
    categoryName: product.categoryName ?? null,
    featuredImageUrl: product.featuredImageUrl ?? null,
    featuredImageAltText: product.featuredImageAltText ?? null,
    optionsJson: product.optionsJson ?? null,
    collectionsJson: product.collectionsJson ?? null,
    option1Name: product.option1Name ?? null,
    option2Name: product.option2Name ?? null,
    option3Name: product.option3Name ?? null,
    variantCount: toNullableInt(product.variantCount),
    visibleOnlineStore: toNullableBoolean(product.visibleOnlineStore),
    variants: {
      create: asArray(variants).map(toVariantNestedCreateInput),
    },
  };
}

function toProductUpdateInput(product, variants) {
  return {
    title: product.title ?? "",
    handle: product.handle ?? null,
    status: product.status ?? "ACTIVE",
    productType: product.productType ?? null,
    vendor: product.vendor ?? null,
    tags: asArray(product.tags),
    templateSuffix: product.templateSuffix ?? null,
    description: product.description ?? null,
    createdAt: product.createdAt ?? null,
    updatedAt: product.updatedAt ?? null,
    publishedAt: product.publishedAt ?? null,
    seoTitle: product.seoTitle ?? null,
    seoDescription: product.seoDescription ?? null,
    totalInventory: toNullableInt(product.totalInventory),
    categoryId: product.categoryId ?? null,
    categoryName: product.categoryName ?? null,
    featuredImageUrl: product.featuredImageUrl ?? null,
    featuredImageAltText: product.featuredImageAltText ?? null,
    optionsJson: product.optionsJson ?? null,
    collectionsJson: product.collectionsJson ?? null,
    option1Name: product.option1Name ?? null,
    option2Name: product.option2Name ?? null,
    option3Name: product.option3Name ?? null,
    variantCount: toNullableInt(product.variantCount),
    visibleOnlineStore: toNullableBoolean(product.visibleOnlineStore),
    variants: {
      deleteMany: {},
      create: asArray(variants).map(toVariantNestedCreateInput),
    },
  };
}

/* ────────────────────────────────────────────────────────────── */
/*  MAIN HANDLER                                                 */
/* ────────────────────────────────────────────────────────────── */

export async function handleProductEditOperation(bulkOperationId) {
  try {
    const history = await prisma.editHistory.findFirst({
      where: { bulkOperationId },
    });

    if (!history) {
      return { success: false };
    }

    const undoJson = asObject(history.undo);
    if (history.status === "completed" && undoJson.status !== "processing") {
      return { success: true };
    }

    const session = await getSession(history.shop);
    const bulkOperation = await fetchBulkOperationDetails(session, bulkOperationId);

    const batchJson = asObject(history.batch);
    const hasMore = Boolean(batchJson.hasMore);

    if (bulkOperation?.errorCode) {
      const updateData = {};
      let errorJson = Array.isArray(history.error) ? history.error : [];
      let undo = asObject(history.undo);

      if (history.status === "processing") {
        errorJson = [
          ...errorJson,
          {
            code: bulkOperation.errorCode,
            message: "Shopify bulk operation failed",
            lastProductId: batchJson.lastProductId ?? null,
            details: bulkOperation,
          },
        ];

        updateData.error = errorJson;

        if (history.processingBatchId) {
          await prisma.changeRecord.updateMany({
            where: { batchId: history.processingBatchId },
            data: { status: "failed" },
          });
        }
      }

      if (undo.status === "processing") {
        const undoErrors = Array.isArray(undo.errors) ? undo.errors : [];
        undo = {
          ...undo,
          errors: [
            ...undoErrors,
            {
              code: bulkOperation.errorCode,
              message: "Shopify bulk operation failed",
            },
          ],
        };
        updateData.undo = undo;
      }

      if (hasMore) {
        if (history.status === "processing") {
          await addbulkEditJob({
            historyId: history.id,
            session,
          });
        }

        if (undo.status === "processing") {
          await addbulkUndoJob({
            historyId: history.id,
            shop: history.shop,
          });
        }
      } else {
        if (history.status === "processing") {
          const completedAt = new Date();
          updateData.status = "failed";
          updateData.completedAt = completedAt;
          updateData.durationMs = calculateDurationMs(history.startedAt, completedAt);
        }

        if (undo.status === "processing") {
          const completedAt = new Date();
          undo = {
            ...undo,
            status: "failed",
            completedAt,
            durationMs: calculateDurationMs(undo.startedAt, completedAt),
          };
          updateData.undo = undo;
        }
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.editHistory.update({
          where: { id: history.id },
          data: updateData,
        });
      }

      return { success: false };
    }

    let processedCount = 0;

    if (bulkOperation?.url) {
      const records = await fetchBulkOperationData(bulkOperation.url, history.shop);
      processedCount = Number(bulkOperation.objectCount || bulkOperation.rootObjectCount || 0);

      if (records.length > 0) {
        await prisma.$transaction(
          async (tx) => {
            for (const { product, variants } of records) {
              const existing = await tx.product.findUnique({
                where: {
                  shop_id: {
                    shop: product.shop,
                    id: product.id,
                  },
                },
                select: {
                  shop: true,
                  id: true,
                  title: true,
                  handle: true,
                  status: true,
                  productType: true,
                  vendor: true,
                  tags: true,
                  templateSuffix: true,
                  description: true,
                  createdAt: true,
                  updatedAt: true,
                  publishedAt: true,
                  seoTitle: true,
                  seoDescription: true,
                  totalInventory: true,
                  categoryId: true,
                  categoryName: true,
                  featuredImageUrl: true,
                  featuredImageAltText: true,
                  optionsJson: true,
                  collectionsJson: true,
                  option1Name: true,
                  option2Name: true,
                  option3Name: true,
                  variantCount: true,
                  visibleOnlineStore: true,
                },
              });

              const mergedProduct = mergeProductForBulkMirror(existing, product);

              await tx.product.upsert({
                where: {
                  shop_id: {
                    shop: product.shop,
                    id: product.id,
                  },
                },
                create: toProductCreateInput(mergedProduct, variants),
                update: toProductUpdateInput(mergedProduct, variants),
              });
            }
          },
          {
            maxWait: 10_000,
            timeout: 60_000,
          },
        );

        await clearKeyCaches(`${history.shop}:ProductFetch`);
        await clearKeyCaches(`${history.shop}:productTypes:`);
      }
    }

    if (hasMore) {
      const updateData = {};
      let undo = asObject(history.undo);
      let processed = history.processedCount ?? 0;
      let undoProcessed = undo.processedCount ?? 0;

      if (history.status === "processing") {
        processed += processedCount;
        updateData.processedCount = processed;
        updateData.durationMs = calculateDurationMs(history.startedAt);

        await addbulkEditJob({
          historyId: history.id,
          session,
        });

        if (history.processingBatchId) {
          await prisma.changeRecord.updateMany({
            where: { batchId: history.processingBatchId },
            data: { status: "completed" },
          });
        }
      }

      if (undo.status === "processing") {
        undoProcessed += processedCount;
        undo = {
          ...undo,
          processedCount: undoProcessed,
          durationMs: calculateDurationMs(undo.startedAt),
        };
        updateData.undo = undo;

        await addbulkUndoJob({
          historyId: history.id,
          shop: history.shop,
        });

        if (history.processingBatchId) {
          await prisma.changeRecord.updateMany({
            where: { batchId: history.processingBatchId },
            data: { status: "undo completed" },
          });
        }
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.editHistory.update({
          where: { id: history.id },
          data: updateData,
        });
      }

      await clearKeyCaches(`${history.shop}:historyDetails:${history.id}`);
      return { success: true };
    }

    const updates = {};
    let undoFinal = asObject(history.undo);
    let processed = history.processedCount ?? 0;
    let undoProcessed = undoFinal.processedCount ?? 0;

    if (history.status === "processing") {
      const completedAt = new Date();
      const { email, shopOwner } = await getShopOwnerEmailAddress(session);

      await sendEmail(
        email,
        "✅ Your Product Edits Are Complete!",
        productEditConfirmationEmailHTML(shopOwner, history.shop, history),
        true,
      );

      processed += processedCount;

      updates.status = "completed";
      updates.completedAt = completedAt;
      updates.editTime = completedAt;
      updates.processedCount = processed;
      updates.durationMs = calculateDurationMs(history.startedAt, completedAt);

      if (history.processingBatchId) {
        await prisma.changeRecord.updateMany({
          where: { batchId: history.processingBatchId },
          data: { status: "completed" },
        });
      }
    }

    if (undoFinal.status === "processing") {
      const completedAt = new Date();

      undoProcessed += processedCount;
      undoFinal = {
        ...undoFinal,
        status: "completed",
        allowed: false,
        completedAt,
        processedCount: undoProcessed,
        durationMs: calculateDurationMs(undoFinal.startedAt, completedAt),
      };

      updates.undo = undoFinal;

      await clearKeyCaches(`${history.shop}:historyChanges:${history.id}`);

      if (history.processingBatchId) {
        await prisma.changeRecord.updateMany({
          where: { batchId: history.processingBatchId },
          data: { status: "undo completed" },
        });
      }
    }

    const batchJsonFinal = asObject(history.batch);
    updates.batch = {
      ...batchJsonFinal,
      lastProductId: null,
      hasMore: false,
    };
    updates.processingBatchId = null;

    await prisma.editHistory.update({
      where: { id: history.id },
      data: updates,
    });

    await clearKeyCaches(`${history.shop}:historyDetails:${history.id}`);

    return { success: true };
  } catch (err) {
    console.error("Bulk operation handler failed:", err);
    throw err;
  }
}

/* ────────────────────────────────────────────────────────────── */
/*  BULK DATA FETCH + PG SHAPE                                   */
/* ────────────────────────────────────────────────────────────── */

export async function fetchBulkOperationData(url, shop) {
  try {
    const response = await axios.get(url, {
      responseType: "text",
      timeout: 120000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    const operations = [];
    const lines = response.data.split("\n").filter(Boolean);
    let skipped = 0;

    for (let i = 0; i < lines.length; i += 1) {
      try {
        const parsed = JSON.parse(lines[i]);
        const product = parsed?.data?.productSet?.product;

        if (!product?.id) {
          const productSet = parsed?.data?.productSet;
          const userErrors = productSet?.userErrors;
          if (userErrors?.length) {
            console.error(`❌ Shopify userErrors on line ${i + 1}:`, JSON.stringify(userErrors));
          } else {
            console.error(`❌ Null product on line ${i + 1}, raw:`, lines[i]);
          }
          skipped += 1;
          continue;
        }

        const variantEdges = asArray(product?.variants?.edges);
        const variants = variantEdges
          .map((edge) => edge?.node)
          .filter((node) => node?.id)
          .map((node) => ({
            id: node.id,
            title: node.title ?? null,
            sku: node.sku ?? null,
            barcode: node.barcode ?? null,
            price: node.price != null ? Number(node.price) : null,
            compareAtPrice:
              node.compareAtPrice != null ? Number(node.compareAtPrice) : null,
            inventoryQuantity:
              node.inventoryQuantity != null ? Number(node.inventoryQuantity) : null,
            inventoryPolicy: node.inventoryPolicy ?? null,
            taxable: node.taxable ?? null,
            taxCode: node.taxCode ?? null,
            position: node.position != null ? Number(node.position) : null,
            selectedOptionsJson: node.selectedOptions ?? null,
            cost:
              node.inventoryItem?.unitCost?.amount != null
                ? Number(node.inventoryItem.unitCost.amount)
                : null,
            countryOfOrigin: node.inventoryItem?.countryCodeOfOrigin ?? null,
            hsTariffCode: node.inventoryItem?.harmonizedSystemCode ?? null,
            weight:
              node.inventoryItem?.measurement?.weight?.value != null
                ? Number(node.inventoryItem.measurement.weight.value)
                : null,
            weightUnit: node.inventoryItem?.measurement?.weight?.unit ?? null,
            option1Value: node.selectedOptions?.[0]?.value ?? null,
            option2Value: node.selectedOptions?.[1]?.value ?? null,
            option3Value: node.selectedOptions?.[2]?.value ?? null,
            physicalProduct: node.inventoryItem?.requiresShipping ?? null,
            tracked: node.inventoryItem?.tracked ?? null,
            profitMargin: null,
          }));

        const collectionsJson = asArray(product?.collections?.edges).map(
          ({ node }) => ({
            id: node?.id ?? null,
            title: node?.title ?? null,
          }),
        );

        const optionsJson = product.options ?? null;
        const productOptions = asArray(product.options);

        const categoryId = product.category?.id ?? null;
        const categoryName = product.category?.name ?? null;

        const seoTitle = product.seo?.title ?? null;
        const seoDescription = product.seo?.description ?? null;

        const tagsArray = Array.isArray(product.tags) ? product.tags : [];
        const featuredImageUrl = product.featuredImage?.url ?? null;
        const featuredImageAltText = product.featuredImage?.altText ?? null;
        const totalInventory =
          product.totalInventory != null ? Number(product.totalInventory) : null;

        const productRow = {
          shop,
          id: product.id,
          title: product.title ?? null,
          handle: product.handle ?? null,
          status: product.status ?? "ACTIVE",
          productType: product.productType ?? null,
          vendor: product.vendor ?? null,
          templateSuffix: product.templateSuffix ?? null,
          description: product.descriptionHtml ?? null,
          createdAt: product.createdAt ? new Date(product.createdAt) : null,
          updatedAt: product.updatedAt ? new Date(product.updatedAt) : null,
          publishedAt: product.publishedAt ? new Date(product.publishedAt) : null,
          tags: tagsArray,
          categoryId,
          categoryName,
          seoTitle,
          seoDescription,
          totalInventory,
          featuredImageUrl,
          featuredImageAltText,
          optionsJson,
          collectionsJson,
          option1Name: productOptions[0]?.name ?? null,
          option2Name: productOptions[1]?.name ?? null,
          option3Name: productOptions[2]?.name ?? null,
          variantCount: variants.length,
          visibleOnlineStore: null,
        };

        operations.push({
          product: productRow,
          variants,
        });
      } catch (err) {
        console.error(`❌ Bulk JSON parse error at line ${i + 1}:`, err.message);
      }
    }

    if (skipped > 0) {
      console.warn(`⚠️ fetchBulkOperationData: skipped ${skipped} invalid lines`);
    }

    return operations;
  } catch (err) {
    console.error("❌ fetchBulkOperationData FAILED:", err.message);
    throw err;
  }
}

/* ────────────────────────────────────────────────────────────── */
/*  NEXT-EDIT SCHEDULER                                          */
/* ────────────────────────────────────────────────────────────── */

async function processNextEdit(shop) {
  try {
    const nextEdit = await prisma.editHistory.findFirst({
      where: {
        shop,
        status: { in: ["pending", "Undo pending"] },
      },
      orderBy: { updatedAt: "asc" },
      select: {
        id: true,
        shop: true,
        status: true,
        rules: true,
      },
    });

    if (!nextEdit) return;

    if (nextEdit.status === "Undo pending") {
      await addbulkUndoJob({
        historyId: nextEdit.id,
        shop: nextEdit.shop,
      });
      return;
    }

    await addbulkEditJob({
      historyId: nextEdit.id,
      session: await getSession(nextEdit.shop),
    });
  } catch (err) {
    throw new Error(err.message);
  }
}

/* ────────────────────────────────────────────────────────────── */
/*  BULK OP METADATA FETCH                                       */
/* ────────────────────────────────────────────────────────────── */

async function fetchBulkOperationDetails(session, bulkOperationId) {
  try {
    const query = `query GetBulkOperationResults($id: ID!) {
      node(id: $id) {
        ... on BulkOperation {
          id
          status
          errorCode
          url
          partialDataUrl
          objectCount
          rootObjectCount
          completedAt
          createdAt
          fileSize
          type
        }
      }
    }`;

    const client = new shopify.api.clients.Graphql({ session });

    const response = await client.query({
      data: {
        query,
        variables: { id: bulkOperationId },
      },
    });

    return response.body?.data?.node ?? null;
  } catch (err) {
    throw new Error(err.message);
  }
}