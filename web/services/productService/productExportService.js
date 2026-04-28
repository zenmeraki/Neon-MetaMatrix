import shopify from "../../shopify.js";
import { fieldMappings } from "../../utils/productExportUtils.js";
import { EXPORT_TYPES } from "../../Config/constants.js";
import { getCache, setCache } from "../../utils/cacheUtils.js";
import { resolveCanonicalProductTarget } from "./productTargetingService.js";
import { productMirrorRepository } from "../../repositories/productMirrorRepository.js";
import { exportJobRepository } from "../../repositories/exportJobRepository.js";

export class ProductExportService {
  constructor(session) {
    this.session = session;
    this.client = new shopify.api.clients.Graphql({ session });
    this.fieldMappings = fieldMappings;
  }

  _checkValidation(count, activePlan) {
    if (activePlan && typeof activePlan === "object") {
      if (activePlan.isUnlimited === true) {
        return;
      }

      const limit = Number(activePlan.limit);
      if (Number.isFinite(limit) && limit > 0 && count > limit) {
        const planName = activePlan.planName || "Current plan";
        throw new Error(
          `${planName} allows exporting up to ${limit} products at a time`,
        );
      }

      return;
    }
  }

  validateRequestedColumns(requestedColumns = []) {
    if (!Array.isArray(requestedColumns) || !requestedColumns.length) {
      throw new Error("At least one export column is required");
    }

    const uniqueColumns = [...new Set(requestedColumns)];
    const invalidColumns = uniqueColumns.filter((column) => !this.fieldMappings[column]);

    if (invalidColumns.length) {
      throw new Error(`Unsupported export columns requested: ${invalidColumns.join(", ")}`);
    }

    if (!uniqueColumns.length) {
      throw new Error("No valid export columns were requested");
    }

    return uniqueColumns;
  }

  async resolveExportTarget({
    filterParams,
    queryWhere,
    productIds,
    page = 1,
    limit = 20,
    cursorId = null,
    mirrorBatchId = null,
  }) {
    const result = await resolveCanonicalProductTarget({
      shop: this.session.shop,
      filterParams,
      explicitWhere: queryWhere,
      explicitProductIds: Array.isArray(productIds) ? productIds : [],
      queryParams: { page, limit },
      sampleLimit: limit,
      cursorId,
      mirrorBatchId,
    });

    return {
      ...result,
      totalCount: result.count,
    };
  }

  escapeCsvValue(value) {
    if (value === null || value === undefined) return "";

    const stringValue = Array.isArray(value)
      ? value.join(", ")
      : String(value);

    if (
      stringValue.includes(",") ||
      stringValue.includes('"') ||
      stringValue.includes("\n") ||
      stringValue.includes("\r")
    ) {
      return `"${stringValue.replaceAll('"', '""')}"`;
    }

    return stringValue;
  }

  buildCsvLine(row, requestedColumns) {
    return requestedColumns
      .map((column) => this.escapeCsvValue(row[column]))
      .join(",");
  }

  writeCsvBlock(writable, lines) {
    if (!Array.isArray(lines) || !lines.length) {
      return Promise.resolve();
    }

    const payload = `${lines.join("\n")}\n`;

    return new Promise((resolve, reject) => {
      function cleanup() {
        writable.off("drain", onDrain);
        writable.off("error", onError);
      }

      function onDrain() {
        cleanup();
        resolve();
      }

      function onError(error) {
        cleanup();
        reject(error);
      }

      writable.once("error", onError);
      const canContinue = writable.write(payload);

      if (canContinue) {
        cleanup();
        resolve();
        return;
      }

      writable.once("drain", onDrain);
    });
  }

  async flushCsvLineBuffer(writable, lineBuffer) {
    if (!lineBuffer.length) {
      return;
    }

    const lines = lineBuffer.splice(0, lineBuffer.length);
    await this.writeCsvBlock(writable, lines);
  }

  async resolveExportPageWithProducts({
    filterParams,
    queryWhere,
    productIds,
    pageSize,
    cursorId,
    mirrorBatchId,
  }) {
    const page = await this.resolveExportTarget({
      filterParams,
      queryWhere,
      productIds,
      page: 1,
      limit: pageSize,
      cursorId,
      mirrorBatchId,
    });

    const pageProductIds = Array.isArray(page.sampleProducts)
      ? page.sampleProducts.map((product) => product.id).filter(Boolean)
      : [];

    if (!pageProductIds.length) {
      return {
        page,
        pageProductIds,
        products: [],
      };
    }

    const products = await productMirrorRepository.findProductsPageForExport({
      shop: this.session.shop,
      mirrorBatchId,
      productIds: pageProductIds,
      pageSize,
    });

    return {
      page,
      pageProductIds,
      products,
    };
  }

  writeCsvRow(writable, row, requestedColumns) {
    const line = this.buildCsvLine(row, requestedColumns);
    return new Promise((resolve, reject) => {
      function cleanup() {
        writable.off("drain", onDrain);
        writable.off("error", onError);
      }

      function onDrain() {
        cleanup();
        resolve();
      }

      function onError(error) {
        cleanup();
        reject(error);
      }

      writable.once("error", onError);
      const canContinue = writable.write(`${line}\n`);

      if (canContinue) {
        cleanup();
        resolve();
        return;
      }

      writable.once("drain", onDrain);
    });
  }

  endWritable(writable) {
    return new Promise((resolve, reject) => {
      function cleanup() {
        writable.off("finish", onFinish);
        writable.off("error", onError);
      }

      function onFinish() {
        cleanup();
        resolve();
      }

      function onError(error) {
        cleanup();
        reject(error);
      }

      writable.once("finish", onFinish);
      writable.once("error", onError);
      writable.end();
    });
  }

  buildExportRow({ product, variant, variantIndex, requestedColumns }) {
    const safeSplitPop = (val) => (val ? val.toString().split("/").pop() : "");
    const selectedOptions = Array.isArray(variant?.selectedOptionsJson)
      ? variant.selectedOptionsJson
      : Array.isArray(variant?.selectedOptions)
        ? variant.selectedOptions
        : [];

    const featuredImage = product?.featuredImageUrl
      ? {
          url: product.featuredImageUrl,
          altText: product.featuredImageAltText ?? "",
        }
      : null;

    const row = {};

    for (const column of requestedColumns) {
      let value = "";

      switch (column) {
        case "ProductID":
          value = variantIndex === 0 ? safeSplitPop(product.id) : "";
          break;
        case "ProductTitle":
          value = variantIndex === 0 ? product.title : "";
          break;
        case "ProductDescription":
          value = variantIndex === 0 ? (product.descriptionHtml ?? product.descriptionText ?? "") : "";
          break;
        case "Vendor":
          value = variantIndex === 0 ? (product.vendor ?? "") : "";
          break;
        case "ProductType":
          value = variantIndex === 0 ? (product.productType ?? "") : "";
          break;
        case "CreatedAt":
          value = variantIndex === 0 ? (product.createdAt ?? "") : "";
          break;
        case "UpdatedAt":
          value = variantIndex === 0 ? (product.updatedAt ?? "") : "";
          break;
        case "PublishedAt":
          value = variantIndex === 0 ? (product.publishedAt ?? "") : "";
          break;
        case "Handle":
          value = variantIndex === 0 ? (product.handle ?? "") : "";
          break;
        case "TemplateSuffix":
          value = variantIndex === 0 ? (product.templateSuffix ?? "") : "";
          break;
        case "Tags":
          value = variantIndex === 0 ? (product.tags ?? []) : "";
          break;
        case "Status":
          value = variantIndex === 0 ? (product.status ?? "") : "";
          break;
        case "SeoTitle":
          value = variantIndex === 0 ? (product.seoTitle ?? "") : "";
          break;
        case "SeoDescription":
          value = variantIndex === 0 ? (product.seoDescription ?? "") : "";
          break;
        case "ProductCategory":
          value = variantIndex === 0 ? (product.categoryName ?? "") : "";
          break;
        case "TotalInventory":
          value = variantIndex === 0 ? (product.totalInventory ?? "") : "";
          break;
        case "VariantID":
          value = variant ? safeSplitPop(variant.id) : "";
          break;
        case "VariantTitle":
          value = variant?.title ?? "";
          break;
        case "Price":
          value = variant?.price ?? "";
          break;
        case "SKU":
          value = variant?.sku ?? "";
          break;
        case "Barcode":
          value = variant?.barcode ?? "";
          break;
        case "InventoryQuantity":
          value = variant?.inventoryQuantity ?? "";
          break;
        case "InventoryPolicy":
          value = variant?.inventoryPolicy ?? "";
          break;
        case "RequiresShipping":
          value = variant?.physicalProduct ?? "";
          break;
        case "Weight":
          value = variant?.weight ?? "";
          break;
        case "WeightUnit":
          value = variant?.weightUnit ?? "";
          break;
        case "CountryOfOrigin":
          value = variant?.countryOfOrigin ?? "";
          break;
        case "HsTariffCode":
          value = variant?.hsTariffCode ?? "";
          break;
        case "Cost":
          value = variant?.cost ?? "";
          break;
        case "TaxCode":
          value = variant?.taxCode ?? "";
          break;
        case "Taxable":
          value = variant?.taxable ?? "";
          break;
        case "Option1":
          value = selectedOptions[0]?.value ?? variant?.option1Value ?? "";
          break;
        case "Option2":
          value = selectedOptions[1]?.value ?? variant?.option2Value ?? "";
          break;
        case "Option3":
          value = selectedOptions[2]?.value ?? variant?.option3Value ?? "";
          break;
        case "ImageURL":
          value = variantIndex === 0 ? (featuredImage?.url ?? "") : "";
          break;
        case "ImageAltText":
          value = variantIndex === 0 ? (featuredImage?.altText ?? "") : "";
          break;
        case "ImageID":
          value = "";
          break;
        default:
          value = "";
      }

      row[column] = value;
    }

    return row;
  }

  async exportProductsToCsvStream({
    filterParams,
    queryWhere,
    productIds,
    requestedColumns,
    subscription,
    writable,
    pageSize = 500,
  }) {
    if (!writable || typeof writable.write !== "function") {
      throw new Error("A writable stream is required for CSV export");
    }

    const validatedColumns = this.validateRequestedColumns(requestedColumns);
    const firstPage = await this.resolveExportPageWithProducts({
      filterParams,
      queryWhere,
      productIds,
      pageSize,
      cursorId: null,
    });
    const target = firstPage.page;

    if (!target?.mirrorBatchId) {
      throw new Error("Cannot export without deterministic mirror batch");
    }

    const totalCount = target.totalCount ?? target.count ?? 0;
    this._checkValidation(totalCount, subscription);
    const lineBuffer = [];
    const rowBufferSize = 250;

    lineBuffer.push(
      this.buildCsvLine(
        Object.fromEntries(validatedColumns.map((column) => [column, column])),
        validatedColumns,
      ),
    );
    await this.flushCsvLineBuffer(writable, lineBuffer);

    let exportedProductCount = 0;
    let exportedRowCount = 0;
    let currentPageResult = firstPage;

    while (currentPageResult) {
      const {
        pageProductIds,
        products,
      } = currentPageResult;

      if (!pageProductIds.length) break;

      const nextCursorId = pageProductIds[pageProductIds.length - 1];
      currentPageResult =
        pageProductIds.length < pageSize
          ? null
          : await this.resolveExportPageWithProducts({
              filterParams,
              queryWhere,
              productIds,
              pageSize,
              cursorId: nextCursorId,
              mirrorBatchId: target.mirrorBatchId,
            });

      const productById = new Map(products.map((product) => [product.id, product]));

      for (const productId of pageProductIds) {
        const product = productById.get(productId);
        if (!product) continue;

        const variants = Array.isArray(product.variants) ? product.variants : [];
        const rowTargets = variants.length ? variants : [null];

        for (let variantIndex = 0; variantIndex < rowTargets.length; variantIndex += 1) {
          const row = this.buildExportRow({
            product,
            variant: rowTargets[variantIndex],
            variantIndex,
            requestedColumns: validatedColumns,
          });
          lineBuffer.push(this.buildCsvLine(row, validatedColumns));

          if (lineBuffer.length >= rowBufferSize) {
            await this.flushCsvLineBuffer(writable, lineBuffer);
          }

          exportedRowCount += 1;
        }

        exportedProductCount += 1;
      }
    }

    await this.flushCsvLineBuffer(writable, lineBuffer);

    await this.endWritable(writable);

    return {
      mirrorBatchId: target.mirrorBatchId,
      productCount: exportedProductCount,
      rowCount: exportedRowCount,
      totalCount,
    };
  }
  async getAllExportHistories(lang) {
    const cacheKey = `${this.session.shop}:fetchExportHistories:${lang}`;

    const cacheHistories = await getCache(cacheKey);
    if (cacheHistories) return cacheHistories;

    const histories = await exportJobRepository.listRecentByShop(
      this.session.shop,
      10,
    );

    const formatedHistory = histories.map((history) => ({
      id: history.id,
      shop: history.shop,
      status: history.status,
      type: EXPORT_TYPES[history.type]?.[lang] || history.type || "",
      rawType: history.type || "",
      filename: history.fileName || history.filename || "",
      rowCount: history.rowCount,
      productCount: history.productCount,
      totalItems: history.totalItems,
      targetSnapshotCount: history.targetSnapshotCount,
      triggerType: history.triggerType,
      isScheduled: history.isScheduled,
      error: history.error,
      startedAt: history.startedAt,
      completedAt: history.completedAt,
      createdAt: history.createdAt,
      updatedAt: history.updatedAt,
    }));

    await setCache(cacheKey, formatedHistory, 300);
    return formatedHistory;
  }

  async getExportHistoryDetails(id) {
    if (!id || id === "undefined" || id === "null") {
      throw new Error("Invalid export history ID");
    }

    const history = await exportJobRepository.findByIdForShop(
      id,
      this.session.shop,
    );

    if (!history) {
      throw new Error("export history not found");
    }

    return history;
  }
}
