import { Worker } from "bullmq";
import fs from "fs";
import csv from "csv-parser";

import { PrismaClient } from "../../generated/prisma/index.js";
import { connection } from "../../Config/redis.js";
import logger from "../../utils/loggerUtils.js";
import {
  buildProductSetMutation,
  diffProductFields,
  diffVariants,
} from "../../utils/importEditUtils.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import ProductBulkService from "../../services/productService/productBulkEditService.js";

const prisma = new PrismaClient();

const QUEUE_NAME = process.env.IMPORT_EDIT_QUEUE || "importEdit";

const normalizeBoolean = (v) => v === true || v === "TRUE" || v === "true";

const normalizeNumber = (v) =>
  v !== undefined && v !== null && v !== "" ? Number(v) : undefined;

function extractProductOptions(existingProduct) {
  const options = [];

  if (existingProduct.option1Name) {
    options.push({
      id: "option1",
      name: existingProduct.option1Name,
      values: [],
    });
  }

  if (existingProduct.option2Name) {
    options.push({
      id: "option2",
      name: existingProduct.option2Name,
      values: [],
    });
  }

  if (existingProduct.option3Name) {
    options.push({
      id: "option3",
      name: existingProduct.option3Name,
      values: [],
    });
  }

  return options;
}

function mapExistingVariantsForDiff(existingVariants) {
  return (existingVariants || []).map((variant) => ({
    id: variant.id,
    title: variant.title,
    sku: variant.sku,
    barcode: variant.barcode,
    price: variant.price,
    compareAtPrice: variant.compareAtPrice,
    inventoryQuantity: variant.inventoryQuantity,
    inventoryPolicy: variant.inventoryPolicy,
    taxable: variant.taxable,
    taxCode: variant.taxCode,
    cost: variant.cost,
    countryOfOrigin: variant.countryOfOrigin,
    hsTariffCode: variant.hsTariffCode,
    weight: variant.weight,
    weightUnit: variant.weightUnit,
    option1: variant.option1Value,
    option2: variant.option2Value,
    option3: variant.option3Value,
    tracked: variant.tracked,
    physicalProduct: variant.physicalProduct,
    profitMargin: variant.profitMargin,
  }));
}

const bulkImportEditWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { historyId, filePath, columnMappings, session } = job.data;
    const localFile = filePath;

    let historyDoc = null;

    try {
      historyDoc = await prisma.editHistory.findUnique({
        where: { id: historyId },
      });

      if (!historyDoc) {
        throw new Error("History document not found");
      }

      await prisma.editHistory.update({
        where: { id: historyId },
        data: {
          status: "processing",
        },
      });

      await clearKeyCaches(`${historyDoc.shop}:fetchHistories`);

      const productMap = new Map();
      let totalRows = 0;
      const formattedProducts = [];

      await new Promise((resolve, reject) => {
        fs.createReadStream(localFile)
          .pipe(csv())
          .on("data", (row) => {
            totalRows++;

            const mapped = {};
            for (const [csvCol, field] of Object.entries(columnMappings || {})) {
              if (field && row[csvCol] !== undefined) {
                mapped[field] = row[csvCol];
              }
            }

            if (!mapped.id) {
              logger.warn("Skipping row - no product id", { row });
              return;
            }

            const productId = mapped.id;

            if (!productMap.has(productId)) {
              productMap.set(productId, {
                productSet: {
                  id: productId,
                  ...(mapped.title && { title: mapped.title }),
                  ...(mapped.vendor && { vendor: mapped.vendor }),
                  ...(mapped.status && { status: mapped.status.toUpperCase() }),
                  ...(mapped.description && {
                    descriptionHtml: mapped.description,
                  }),
                  ...(mapped.productType && {
                    productType: mapped.productType,
                  }),
                  ...(mapped.handle && { handle: mapped.handle }),
                  ...(mapped.tags && { tags: mapped.tags }),
                  ...((mapped.metaTitle || mapped.metaDescription) && {
                    seo: {
                      ...(mapped.metaTitle && { title: mapped.metaTitle }),
                      ...(mapped.metaDescription && {
                        description: mapped.metaDescription,
                      }),
                    },
                  }),
                  options: [],
                  variants: [],
                },
              });

              const productRef = productMap.get(productId).productSet;

              if (mapped.option1Name) {
                productRef.options.push({ name: mapped.option1Name });
              }
              if (mapped.option2Name) {
                productRef.options.push({ name: mapped.option2Name });
              }
              if (mapped.option3Name) {
                productRef.options.push({ name: mapped.option3Name });
              }
            }

            if (mapped.variant_id) {
              productMap.get(productId).productSet.variants.push({
                id: mapped.variant_id,
                ...(mapped.price && { price: normalizeNumber(mapped.price) }),
                ...(mapped.compareAtPrice && {
                  compareAtPrice: normalizeNumber(mapped.compareAtPrice),
                }),
                ...(mapped.sku && { sku: mapped.sku }),
                ...(mapped.barcode && { barcode: mapped.barcode }),
                ...(mapped.taxable !== undefined && {
                  taxable: normalizeBoolean(mapped.taxable),
                }),
                ...(mapped.option1Value && { option1: mapped.option1Value }),
                ...(mapped.option2Value && { option2: mapped.option2Value }),
                ...(mapped.option3Value && { option3: mapped.option3Value }),
              });
            }
          })
          .on("end", resolve)
          .on("error", (err) => {
            logger.error("CSV parsing error", { error: err.message });
            reject(err);
          });
      });

      for (const { productSet } of productMap.values()) {
        const existingProduct = await prisma.product.findUnique({
          where: {
            shop_id: {
              shop: historyDoc.shop,
              id: productSet.id,
            },
          },
          include: {
            variants: true,
          },
        });

        if (!existingProduct) {
          logger.warn("Product not found in DB", {
            productId: productSet.id,
            shop: historyDoc.shop,
          });
          continue;
        }

        const existingProductForDiff = {
          ...existingProduct,
          descriptionHtml: existingProduct.description,
          productType: existingProduct.productType,
          tags: existingProduct.tags,
          seo: {
            title: existingProduct.seoTitle,
            description: existingProduct.seoDescription,
          },
          options: extractProductOptions(existingProduct),
          variants: mapExistingVariantsForDiff(existingProduct.variants),
        };

        const productFieldChanges = diffProductFields(
          existingProductForDiff,
          productSet,
        );

        const variantFieldChanges = diffVariants(
          existingProductForDiff.variants,
          productSet.variants,
        );

        if (!productFieldChanges.length && !variantFieldChanges.length) {
          logger.debug("No changes detected", {
            productId: productSet.id,
          });
          continue;
        }

        const mutationPayload = buildProductSetMutation({
          productSet,
          existingProduct: existingProductForDiff,
        });

        formattedProducts.push(JSON.stringify(mutationPayload));

        await prisma.changeRecord.create({
          data: {
            options: extractProductOptions(existingProduct),
            editHistoryId: historyId,
            productId: productSet.id,
            shop: historyDoc.shop,
            title: existingProduct.title,
            image: existingProduct.featuredImageUrl,
            scope: "mixed",
            batchId: String(job.id),
            productFieldChanges,
            variantFieldChanges,
            status: "pending",
          },
        });
      }

      const service = new ProductBulkService(session);

      const result = await service._bulkOperationHelper({
        formattedProducts: formattedProducts.join("\n"),
        field: "mixed",
      });

      if (!result?.bulkOperation?.id) {
        throw new Error("Missing bulkOperationId in Shopify response");
      }

      await prisma.editHistory.update({
        where: { id: historyId },
        data: {
          totalRows,
          bulkOperationId: result.bulkOperation.id,
          totalItems: formattedProducts.length,
        },
      });

      await prisma.spreadsheetFile.updateMany({
        where: {
          editHistoryId: historyId,
        },
        data: {
          totalRows,
        },
      });

      await clearKeyCaches(`${historyDoc.shop}:fetchHistories`);

      if (localFile && fs.existsSync(localFile)) {
        fs.unlinkSync(localFile);
      }
    } catch (error) {
      logger.error("Worker failed", {
        jobId: job.id,
        error: error.message,
        stack: error.stack,
      });

      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      const existingHistory = await prisma.editHistory.findUnique({
        where: { id: historyId },
        select: { id: true, shop: true },
      });

      if (existingHistory) {
        await prisma.editHistory.update({
          where: { id: historyId },
          data: {
            status: "failed",
            error: {
              message: error.message,
              stack: error.stack,
              failedAt: new Date().toISOString(),
            },
          },
        });

        await clearKeyCaches(`${existingHistory.shop}:fetchHistories`);
      }
    }
  },
  { connection, concurrency: 1 },
);

if (process.env.NODE_ENV !== "production") {
  bulkImportEditWorker
    .on("active", (job) => logger.info("Import started", { jobId: job.id }))
    .on("completed", (job) =>
      logger.info("Import completed", { jobId: job.id }),
    )
    .on("failed", (job, err) =>
      logger.error("Import failed", {
        jobId: job?.id,
        error: err.message,
      }),
    );
}

export default bulkImportEditWorker;