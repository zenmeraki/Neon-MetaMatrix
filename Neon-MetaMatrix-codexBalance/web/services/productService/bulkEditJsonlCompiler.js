import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { prisma } from "../../config/database.js";
import { getUpdatedProducts } from "../../helpers/productBulkOperationHelpers/productUpdateHandler.js";
import { productMirrorRepository } from "../../repositories/productMirrorRepository.js";

const PAGE_SIZE = Math.max(
  Number(process.env.BULK_EDIT_JSONL_PAGE_SIZE || 500) || 500,
  1,
);
const CHANGE_BATCH_SIZE = Math.max(
  Number(process.env.BULK_EDIT_CHANGE_BATCH_SIZE || 1000) || 1000,
  1,
);

function normalizeMirrorProduct(product) {
  return {
    ...product,
    description: product.descriptionHtml ?? product.descriptionText ?? "",
    options: Array.isArray(product.optionsJson) ? product.optionsJson : [],
    variants: Array.isArray(product.variants)
      ? product.variants.map((variant) => ({
          ...variant,
          selectedOptions: Array.isArray(variant.selectedOptionsJson)
            ? variant.selectedOptionsJson
            : [],
        }))
      : [],
    seo: {
      title: product.seoTitle ?? "",
      description: product.seoDescription ?? "",
    },
    category:
      product.categoryId || product.categoryName
        ? { id: product.categoryId, name: product.categoryName }
        : null,
    collections: Array.isArray(product.collectionsJson)
      ? product.collectionsJson
      : [],
  };
}

function normalizeMutationLine(value) {
  if (!value) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    JSON.parse(trimmed);
    return trimmed;
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return null;
}

function writeLine(stream, value) {
  const line = normalizeMutationLine(value);
  if (!line) return Promise.resolve(false);

  return new Promise((resolve, reject) => {
    function cleanup() {
      stream.off("drain", onDrain);
      stream.off("error", onError);
    }

    function onDrain() {
      cleanup();
      resolve(true);
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    stream.once("error", onError);
    const ok = stream.write(`${line}\n`);

    if (ok) {
      cleanup();
      resolve(true);
      return;
    }

    stream.once("drain", onDrain);
  });
}

async function flushChanges(changeBuffer) {
  if (!changeBuffer.length) return;

  const batch = changeBuffer.splice(0, changeBuffer.length);

  await prisma.changeRecord.createMany({
    data: batch,
    skipDuplicates: false,
  });
}

function normalizeChangeRecord(change, { product, batchId }) {
  return {
    editHistoryId: change.editHistoryId,
    productId: change.productId || product.id,
    shop: change.shop,
    options: change.options ?? product.options ?? [],
    productFieldChanges: change.productFieldChanges ?? [],
    variantFieldChanges: change.variantFieldChanges ?? [],
    image: change.image ?? product.featuredImageUrl ?? null,
    title: change.title ?? product.title ?? "",
    scope: change.scope ?? "product",
    status: change.status ?? "pending",
    batchId: change.batchId ?? batchId,
  };
}

export async function compileBulkEditJsonl({
  shop,
  historyId,
  executionIdentity,
  mirrorBatchId,
  rules,
}) {
  if (!shop || !historyId || !executionIdentity || !mirrorBatchId) {
    throw new Error(
      "compileBulkEditJsonl requires shop, historyId, executionIdentity, and mirrorBatchId",
    );
  }

  if (!Array.isArray(rules) || !rules.length) {
    throw new Error("compileBulkEditJsonl requires at least one edit rule");
  }

  const filePath = path.join(
    os.tmpdir(),
    `bulk-edit-${historyId}-${crypto.randomUUID()}.jsonl`,
  );

  const stream = fs.createWriteStream(filePath, { encoding: "utf8" });

  let cursorOrdinal = 0;
  let productCount = 0;
  let jsonlLineCount = 0;
  let changeCount = 0;
  const changeBuffer = [];

  await prisma.changeRecord.deleteMany({
    where: {
      editHistoryId: historyId,
      shop,
      status: "pending",
    },
  });

  try {
    while (true) {
      const page = await productMirrorRepository.findProductsPageForTargetSnapshot({
        shop,
        ownerType: "EDIT_HISTORY",
        ownerId: historyId,
        cursorOrdinal,
        pageSize: PAGE_SIZE,
        includeVariants: true,
      });

      if (!page.products.length) break;

      for (const rawProduct of page.products) {
        const product = normalizeMirrorProduct(rawProduct);
        const productChanges = [];
        const batchId = crypto
          .createHash("sha1")
          .update(`${executionIdentity}:${product.id}`)
          .digest("hex");

        for (const rule of rules) {
          const beforeChangeLength = productChanges.length;
          const result = getUpdatedProducts({
            product,
            field: rule.field,
            editType: rule.editOption,
            value: rule.value,
            searchKey: rule.searchKey,
            replaceText: rule.replaceText,
            supportValue: rule.supportValue,
            changes: productChanges,
            historyId,
            shop,
            batchId,
            executionIdentity,
            mirrorBatchId,
          });

          const payloads = Array.isArray(result) ? result : [result];
          for (const payload of payloads) {
            if (await writeLine(stream, payload)) {
              jsonlLineCount += 1;
            }
          }

          const newChanges = productChanges.slice(beforeChangeLength);
          for (const change of newChanges) {
            changeBuffer.push(normalizeChangeRecord(change, { product, batchId }));
            changeCount += 1;

            if (changeBuffer.length >= CHANGE_BATCH_SIZE) {
              await flushChanges(changeBuffer);
            }
          }
        }

        productCount += 1;
      }

      cursorOrdinal = page.lastOrdinal;

      await prisma.editHistory.updateMany({
        where: {
          id: historyId,
          shop,
          executionIdentity,
        },
        data: {
          processedCount: productCount,
          batch: {
            lastOrdinal: cursorOrdinal,
            hasMore: page.hasMore,
            currentBatchTargetCount: page.products.length,
          },
        },
      });

      if (!page.hasMore) break;
    }

    await flushChanges(changeBuffer);
  } catch (error) {
    stream.destroy();
    await fs.promises.unlink(filePath).catch(() => {});
    throw error;
  }

  await new Promise((resolve, reject) => {
    stream.end(resolve);
    stream.once("error", reject);
  });

  const stat = await fs.promises.stat(filePath);

  if (jsonlLineCount <= 0) {
    await fs.promises.unlink(filePath).catch(() => {});
    throw new Error("EMPTY_BULK_EDIT_JSONL_PAYLOAD");
  }

  return {
    filePath,
    productCount,
    jsonlLineCount,
    changeCount,
    bytes: stat.size,
    lastOrdinal: cursorOrdinal,
    hasMore: false,
    batchTargetCount: productCount,
  };
}
