import shopify from "../../shopify.js";
import { Parser } from "json2csv";
import { fieldMappings } from "../../utils/productExportUtils.js";
import { graphqlProductsAllFieldQuery } from "../../graphql/product.js";
import CacheService from "../../utils/cacheService.js";
import { EXPORT_TYPES } from "../../Config/constants.js";
import logger from "../../utils/loggerUtils.js";
import { getCache, setCache } from "../../utils/cacheUtils.js";
import { prisma } from "../../Config/database.js";

export class ProductExportService {
  constructor(session) {
    this.session = session;
    this.client = new shopify.api.clients.Graphql({ session });
    this.fieldMappings = fieldMappings;
  }

  async _countProducts({ queryFilter = null }) {
    try {
      const countData = await this.client.query({
        data: {
          query: `
            query GetProductsCount($query: String) {
              productsCount(query: $query, limit: null) {
                count
              }
            }
          `,
          variables: { query: queryFilter },
        },
      });
      const count = countData.body.data.productsCount.count;

      return count;
    } catch (err) {
      throw new Error(err.message);
    }
  }

  async fetchProducts({ queryFilter = null, count = 0 }) {
    const cacheData = await CacheService.get(
      `${this.session.shop}:${queryFilter}:export`
    );

    if (cacheData) {
      return cacheData;
    }

    let hasNextPage = true;
    let endCursor = null;
    const allProducts = [];

    while (hasNextPage) {
      try {
        const response = await this.client.query({
          data: {
            query: graphqlProductsAllFieldQuery,
            variables: {
              first: 250,
              after: endCursor || null,
              query: queryFilter || null,
            },
          },
        });

        const edges = response.body.data.products.edges;
        allProducts.push(...edges);
        hasNextPage = response.body.data.products.pageInfo.hasNextPage;
        endCursor = response.body.data.products.pageInfo.endCursor;
        // Safety check - if we've fetched all products or reached the count, stop
        if (allProducts.length >= count) {
          break;
        }
      } catch (error) {
        break;
      }
    }
    await setCache(
      `${this.session.shop}:${queryFilter}:export`,
      allProducts,
      300
    );
    return allProducts;
  }

  _checkValidation(count, activePlan) {
    if (activePlan === "Basic (Monthly)") {
      if (count > 50) {
        throw new Error(
          "You are a basic plan user, you can only export 50 products at a time"
        );
      }
    } else if (activePlan === "Advanced (Monthly)") {
      if (count > 150) {
        throw new Error(
          "You are a pro plan user, you can only export 100 products at a time"
        );
      }
    }
  }

  transformToCSV(products, requestedColumns) {
    const csvData = [];

    const getNestedValue = (obj, path, defaultValue = "") =>
      path.reduce(
        (acc, key) =>
          acc && acc[key] !== undefined && acc[key] !== null
            ? acc[key]
            : defaultValue,
        obj
      );

    const safeSplitPop = (val) => (val ? val.toString().split("/").pop() : "");

    products.forEach((product) => {
      const variants = product.variants || [];
      const images = product.media || [];

      if (variants.length > 0) {
        variants.forEach((variant, index) => {
          const row = {};
          requestedColumns.forEach((column) => {
            const path = this.fieldMappings[column]?.split(".") || [];
            let value = "";

            if (path[0] === "variants") {
              value = getNestedValue(variant, path.slice(1));
            } else if (path[0] === "images" && images.length > 0) {
              value = getNestedValue(images[0], path.slice(1));
            } else {
              value = index === 0 ? getNestedValue(product, path) : "";
            }

            // Special cases
            if (column === "Weight") {
              const weight = variant?.inventoryItem?.measurement?.weight;
              value = weight
                ? `${weight.value} ${weight.unit}`
                : "Not Specified";
            }

            if (column === "ProductID")
              value = index === 0 ? safeSplitPop(product.id) : "";
            if (column === "VariantID") value = safeSplitPop(value);

            row[column] =
              value !== null && value !== undefined ? value.toString() : "";
          });
          csvData.push(row);
        });
      } else {
        const row = {};
        requestedColumns.forEach((column) => {
          const path = this.fieldMappings[column]?.split(".") || [];
          let value =
            path[0] === "images" && images.length > 0
              ? getNestedValue(images[0], path.slice(1))
              : getNestedValue(product, path);

          if (column === "VariantID") value = safeSplitPop(value);
          if (column === "ProductID") value = safeSplitPop(product.id);

          row[column] =
            value !== null && value !== undefined ? value.toString() : "";
        });
        csvData.push(row);
      }
    });

    const parser = new Parser();
    return parser.parse(csvData);
  }

  async getAllExportHistories(lang) {
    const cacheKey = `${this.session.shop}:fetchExportHistories:${lang}`;

    const cacheHistories = await getCache(cacheKey);
    if (cacheHistories) return cacheHistories;

    // ✅ CONVERTED TO PRISMA
    const histories = await prisma.exportJob.findMany({
      where: { shop: this.session.shop },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const formatedHistory = histories.map((history) => ({
      ...history,
      type: EXPORT_TYPES[history.type]?.[lang] || history.type || "",
    }));

    await setCache(cacheKey, formatedHistory, 300);
    return formatedHistory;
  }

  async getExportHistoryDetails(id) {
  if (!id || id === "undefined" || id === "null") {
    throw new Error("Invalid export history ID");
  }

  const history = await prisma.exportJob.findFirst({
    where: {
      id,
      shop: this.session.shop,
    },
  });

  if (!history) {
    throw new Error("export history not found");
  }

  return history;
}
}