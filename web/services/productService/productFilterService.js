import shopify from "../../shopify.js";
import readline from "readline";

import { graphqlProductsAllFieldQuery } from "../../graphql/product.js";
import logger from "../../utils/loggerUtils.js";
import { getCache, setCache, clearKeyCaches } from "../../utils/cacheUtils.js";
import { prisma } from "../../config/database.js";

const operatorMap = {
  is: "equals",
  "is not": "does not equal",
};


export class Services {
  constructor() { }

  async getProductsWithFilters({ queryParams = {}, filterParams = [], shop = null }) {
    try {
      const { page = 1, limit = 20, sortKey, sortOrder } = queryParams;

      const cacheKey = `${shop}:ProductFetch:${JSON.stringify(queryParams)}:${JSON.stringify(filterParams)}`;
      const cachData = await getCache(cacheKey);

      if (cachData) return cachData;

      const where = this.getProductPrismaWhere(filterParams, shop);

      const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
      const perPage = parseInt(limit, 10);

      const orderBy = this.buildPrismaSortQuery(sortKey, sortOrder);

      const products = await prisma.product.findMany({
        where,
        select: {
          title: true,
          id: true,
          status: true,
          productType: true,
          vendor: true,
          totalInventory: true,
          featuredImageUrl: true,
          categoryName: true,
          handle: true,
          templateSuffix: true,
          variantCount: true,
          visibleOnlineStore: true,
          // visiblePos: true,
        },
        orderBy,
        skip,
        take: perPage,
      });

      const count = await prisma.product.count({ where });

      const returnData = {
        products,
        count,
        pagination: {
          total: count,
          page: parseInt(page, 10),
          limit: perPage,
          totalPages: Math.ceil(count / perPage),
          hasNextPage: skip + perPage < count,
          hasPrevPage: parseInt(page, 10) > 1,
        },
      };

      await setCache(cacheKey, returnData, 300);

      return returnData;
    } catch (err) {
      throw new Error(err.message);
    }
  }

  getProductPrismaWhere(filterParams = [], shop) {
    const where = { shop };
    const AND = [];

    for (const rawFilter of filterParams) {
      const field = rawFilter?.field;
      const operator = rawFilter?.operator;
      const value = rawFilter?.value;

      if (!field) continue;

      switch (field) {
        case "search":
          AND.push({
            OR: [
              { title: { contains: value, mode: "insensitive" } },
              { vendor: { contains: value, mode: "insensitive" } },
              { productType: { contains: value, mode: "insensitive" } },
              { handle: { contains: value, mode: "insensitive" } },
              { description: { contains: value, mode: "insensitive" } },
              { categoryName: { contains: value, mode: "insensitive" } },
            ],
          });
          break;

        // PRODUCT FIELDS
        case "title":
          AND.push(this.buildPrismaStringFilter("title", operator, value));
          break;

        case "vendor":
          AND.push(this.buildPrismaStringFilter("vendor", operator, value));
          break;

        case "handle":
          AND.push(this.buildPrismaStringFilter("handle", operator, value));
          break;

        case "description":
          AND.push(this.buildPrismaStringFilter("description", operator, value));
          break;

        case "product_type":
          AND.push(this.buildPrismaStringFilter("productType", operator, value));
          break;

        case "status":
          AND.push(this.buildPrismaStringFilter("status", operator, String(value).toUpperCase()));
          break;

        case "inventory_q":
          AND.push(this.buildPrismaNumberFilter("totalInventory", operator, value));
          break;

        case "created_at":
          AND.push(this.buildPrismaDateFilter("createdAt", operator, value));
          break;

        case "updated_at":
          AND.push(this.buildPrismaDateFilter("updatedAt", operator, value));
          break;

        case "published_at":
          AND.push(this.buildPrismaDateFilter("publishedAt", operator, value));
          break;

        case "product_id":
          AND.push(this.buildPrismaStringFilter("id", operator, value));
          break;

        case "category":
          AND.push(this.buildPrismaStringFilter("categoryName", operator, value));
          break;

        case "tag":
          AND.push(this.buildPrismaArrayStringFilter("tags", operator, value));
          break;

        case "theme_template":
          AND.push(this.buildPrismaStringFilter("templateSuffix", operator, value));
          break;

        case "collection":
          AND.push(this.buildPrismaCollectionFilter(operator, value));
          break;

        case "variant_count":
        case "vc":
          AND.push(this.buildPrismaNumberFilter("variantCount", operator, value));
          break;

        case "option_name_1":
          AND.push(this.buildPrismaStringFilter("option1Name", operator, value));
          break;

        case "option_name_2":
          AND.push(this.buildPrismaStringFilter("option2Name", operator, value));
          break;

        case "option_name_3":
          AND.push(this.buildPrismaStringFilter("option3Name", operator, value));
          break;

        case "visible_online_store":
          AND.push(this.buildPrismaBooleanFilter("visibleOnlineStore", operator, value));
          break;

        // case "visible_pos":
        //   AND.push(this.buildPrismaBooleanFilter("visiblePos", operator, value));
        //   break;

        // VARIANT FIELDS
        case "sku":
          AND.push({
            variants: {
              some: this.buildPrismaStringFilter("sku", operator, value),
            },
          });
          break;

        case "barcode":
          AND.push({
            variants: {
              some: this.buildPrismaStringFilter("barcode", operator, value),
            },
          });
          break;

        case "variant_title":
          AND.push({
            variants: {
              some: this.buildPrismaStringFilter("title", operator, value),
            },
          });
          break;

        case "price":
          AND.push({
            variants: {
              some: this.buildPrismaNumberFilter("price", operator, value),
            },
          });
          break;

        case "compare_at_price":
          AND.push({
            variants: {
              some: this.buildPrismaNumberFilter("compareAtPrice", operator, value),
            },
          });
          break;

        case "variant_inventory_q":
          AND.push({
            variants: {
              some: this.buildPrismaNumberFilter("inventoryQuantity", operator, value),
            },
          });
          break;

        case "charge_tax":
          AND.push({
            variants: {
              some: this.buildPrismaBooleanFilter("taxable", operator, value),
            },
          });
          break;

        case "cost":
          AND.push({
            variants: {
              some: this.buildPrismaNumberFilter("cost", operator, value),
            },
          });
          break;

        case "country_of_origin":
          AND.push({
            variants: {
              some: this.buildPrismaStringFilter("countryOfOrigin", operator, value),
            },
          });
          break;

        case "hs_tariff_code":
          AND.push({
            variants: {
              some: this.buildPrismaStringFilter("hsTariffCode", operator, value),
            },
          });
          break;

        case "inventory_policy":
        case "inventory_out_of_stock_policy":
          AND.push({
            variants: {
              some: this.buildPrismaStringFilter("inventoryPolicy", operator, value),
            },
          });
          break;

        case "option_value_1":
          AND.push({
            variants: {
              some: this.buildPrismaStringFilter("option1Value", operator, value),
            },
          });
          break;

        case "option_value_2":
          AND.push({
            variants: {
              some: this.buildPrismaStringFilter("option2Value", operator, value),
            },
          });
          break;

        case "option_value_3":
          AND.push({
            variants: {
              some: this.buildPrismaStringFilter("option3Value", operator, value),
            },
          });
          break;

        case "physical_product":
          AND.push({
            variants: {
              some: this.buildPrismaBooleanFilter("physicalProduct", operator, value),
            },
          });
          break;

        case "track_quantity":
          AND.push({
            variants: {
              some: this.buildPrismaBooleanFilter("tracked", operator, value),
            },
          });
          break;
case "seo":
case "seo_visibility":
  if (value === "true") {
    AND.push({
      OR: [
        { seoTitle: { not: null } },
        { seoDescription: { not: null } }
      ]
    });
  } else {
    AND.push({
      AND: [
        { seoTitle: null },
        { seoDescription: null }
      ]
    });
  }
  break;
        case "profit_margin":
          AND.push({
            variants: {
              some: this.buildPrismaNumberFilter("profitMargin", operator, value),
            },
          });
          break;

        case "weight":
          AND.push({
            variants: {
              some: this.buildPrismaNumberFilter("weight", operator, value),
            },
          });
          break;

        case "weight_unit":
          AND.push({
            variants: {
              some: this.buildPrismaStringFilter("weightUnit", operator, value),
            },
          });
          break;

        // case "connected_inventory_location":
        //   AND.push({
        //     variants: {
        //       some: this.buildInventoryLocationFilter(operator, value),
        //     },
        //   });
        //   break;

        default:
          break;
      }
    }

    if (AND.length > 0) {
      where.AND = AND;
    }

    return where;
  }

  

  buildPrismaSortQuery(sortKey, sortOrder) {
    const order = sortOrder === "desc" ? "desc" : "asc";

    switch (sortKey) {
      case "CREATED_AT":
        return { createdAt: order };

      case "ID":
        return { id: order };

      case "INVENTORY_TOTAL":
        return { totalInventory: order };

      case "PRODUCT_TYPE":
        return { productType: order };

      case "PUBLISHED_AT":
        return { publishedAt: order };

      case "TITLE":
        return { title: order };

      case "UPDATED_AT":
        return { updatedAt: order };

      case "VENDOR":
        return { vendor: order };

      default:
        return { createdAt: "desc" };
    }
  }

  buildPrismaStringFilter(field, operator, value) {
    switch (operator) {
      case "equals":
      case "is":
        return { [field]: { equals: value, mode: "insensitive" } };

      case "does not equal":
      case "is not":
        return { NOT: { [field]: { equals: value, mode: "insensitive" } } };

      case "contains":
        return { [field]: { contains: value, mode: "insensitive" } };

      case "does not contain":
        return { NOT: { [field]: { contains: value, mode: "insensitive" } } };

      case "starts with":
        return { [field]: { startsWith: value, mode: "insensitive" } };

      case "ends with":
        return { [field]: { endsWith: value, mode: "insensitive" } };

      case "is empty":
      case "is empty/blank":
        return {
          OR: [{ [field]: null }, { [field]: "" }],
        };

      case "is not empty":
        return {
          AND: [
            { [field]: { not: null } },
            { NOT: { [field]: "" } },
          ],
        };

      default:
        return {};
    }
  }

  buildPrismaNumberFilter(field, operator, value) {
    const num = Number(value);
    if (Number.isNaN(num)) return {};

    switch (operator) {
      case "<":
      case "less than":
        return { [field]: { lt: num } };

      case "<=":
      case "less than or equal":
        return { [field]: { lte: num } };

      case ">":
      case "greater than":
        return { [field]: { gt: num } };

      case ">=":
      case "greater than or equal":
        return { [field]: { gte: num } };

      case "=":
      case "equals":
      case "is":
        return { [field]: { equals: num } };

      case "!=":
      case "does not equal":
      case "is not":
        return { NOT: { [field]: { equals: num } } };

      case "is empty":
      case "is empty/blank":
        return { [field]: null };

      case "is not empty":
        return { [field]: { not: null } };

      default:
        return {};
    }
  }

  buildPrismaBooleanFilter(field, operator, value) {
    let normalized;

    if (typeof value === "boolean") {
      normalized = value;
    } else {
      const s = String(value).trim().toLowerCase();
      normalized = ["true", "1", "yes", "active"].includes(s);
    }

    switch (operator) {
      case "equals":
      case "is":
      case "=":
        return { [field]: normalized };

      case "does not equal":
      case "is not":
      case "!=":
        return { NOT: { [field]: normalized } };

      case "is empty":
      case "is empty/blank":
        return { [field]: null };

      case "is not empty":
        return { [field]: { not: null } };

      default:
        return { [field]: normalized };
    }
  }

  buildPrismaDateFilter(field, operator, value) {
    const now = new Date();

    switch (operator) {
      case "is before":
        return { [field]: { lt: new Date(value) } };

      case "is after":
        return { [field]: { gt: new Date(value) } };

      case "is on":
        return {
          AND: [
            { [field]: { gte: new Date(`${value}T00:00:00.000Z`) } },
            { [field]: { lt: new Date(`${value}T23:59:59.999Z`) } },
          ],
        };

      case "is before x days ago": {
        const before = new Date();
        before.setDate(now.getDate() - Number(value));
        return { [field]: { lt: before } };
      }

      case "is after x days ago": {
        const after = new Date();
        after.setDate(now.getDate() - Number(value));
        return { [field]: { gt: after } };
      }

      case "is empty":
      case "is empty/blank":
        return { [field]: null };

      case "is not empty":
        return { [field]: { not: null } };

      default:
        return {};
    }
  }

  buildPrismaArrayStringFilter(field, operator, value) {
    switch (operator) {
      case "contains":
      case "equals":
      case "is":
        return { [field]: { has: value } };

      case "does not contain":
      case "does not equal":
      case "is not":
        return { NOT: { [field]: { has: value } } };

      case "is empty":
      case "is empty/blank":
        return { OR: [{ [field]: { isEmpty: true } }, { [field]: { equals: [] } }] };

      case "is not empty":
        return { NOT: { [field]: { equals: [] } } };

      default:
        return {};
    }
  }

  buildPrismaCollectionFilter(operator, value) {
    switch (operator) {
      case "equals":
      case "is":
        return {
          collectionsJson: {
            path: "$[*].title",
            array_contains: [value],
          },
        };

      case "contains":
        return {
          OR: [
            {
              collectionsJson: {
                path: "$[*].title",
                array_contains: [value],
              },
            },
            {
              collectionsJson: {
                string_contains: value,
              },
            },
          ],
        };

      case "does not equal":
      case "is not":
      case "does not contain":
        return {
          NOT: {
            OR: [
              {
                collectionsJson: {
                  path: "$[*].title",
                  array_contains: [value],
                },
              },
              {
                collectionsJson: {
                  string_contains: value,
                },
              },
            ],
          },
        };

      case "is empty":
      case "is empty/blank":
        return {
          OR: [
            { collectionsJson: null },
            { collectionsJson: { equals: [] } },
          ],
        };

      default:
        return {};
    }
  }

  // buildInventoryLocationFilter(operator, value) {
  //   switch (operator) {
  //     case "equals":
  //     case "is":
  //     case "contains":
  //       return {
  //         inventoryLocations: {
  //           string_contains: value,
  //         },
  //       };

  //     case "does not equal":
  //     case "is not":
  //     case "does not contain":
  //       return {
  //         NOT: {
  //           inventoryLocations: {
  //             string_contains: value,
  //           },
  //         },
  //       };

  //     case "is empty":
  //     case "is empty/blank":
  //       return {
  //         OR: [
  //           { inventoryLocations: null },
  //           { inventoryLocations: { equals: [] } },
  //         ],
  //       };

  //     default:
  //       return {};
  //   }
  // }
  async startBulkOperationToFetchProducts({ session, isInitialSync = false }) {
    try {
      const client = new shopify.api.clients.Graphql({ session });

      const queryBody = String(graphqlProductsAllFieldQuery || "").trim();

    if (!queryBody) {
      throw new Error("graphqlProductsAllFieldQuery is empty");
    }

    const bulkQuery = `
      mutation {
        bulkOperationRunQuery(
          query: ${JSON.stringify(queryBody)}
        ) {
          bulkOperation {
            id
            status
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

      const response = await client.query({ data: bulkQuery });

       const runQueryResult = response.body?.data?.bulkOperationRunQuery;
    const userErrors = runQueryResult?.userErrors || [];
    const bulkOperation = runQueryResult?.bulkOperation;

    if (userErrors.length > 0) {
      throw new Error(JSON.stringify(userErrors));
    }

    if (!bulkOperation?.id) {
      throw new Error("Bulk operation was not created");
    }

      await prisma.store.update({
        where: { shopUrl: session.shop },
        data: {
          isProductSyncing: true,
          lastProductSyncAt: new Date(),
        },
      });

      const cacheKey = `${session.shop}:sync_details`;
      await clearKeyCaches(cacheKey);

      await prisma.syncHistory.create({
        data: {
          shop: session.shop,
          bulkOperationId: bulkOperation.id,
          status: "processing",
          operationType: "Product",
          isInitialProductSync: isInitialSync,
        },
      });

      return {
        message: "Bulk product sync started",
        bulkOperationId: bulkOperation.id,
        response: response.body,
      };
    } catch (err) {
      throw new Error(err.message);
    }
  }
  async formatAndSyncProductsToDB({ dataStream, shop, replaceShopData = true }) {
    return new Promise((resolve, reject) => {
      const PRODUCT_BATCH_SIZE = 1000;

      let productBatch = [];
      let totalProductsProcessed = 0;
      let totalVariantsProcessed = 0;

      const productsMap = new Map();

      const normalizeNullableString = (value) => {
        if (value === undefined || value === null) return null;
        const s = String(value).trim();
        return s === "" ? null : s;
      };

      const normalizeNullableFloat = (value) => {
        if (value === undefined || value === null || value === "") return null;
        const n = Number(value);
        return Number.isNaN(n) ? null : n;
      };

      const normalizeNullableInt = (value) => {
        if (value === undefined || value === null || value === "") return null;
        const n = Number(value);
        return Number.isNaN(n) ? null : Math.trunc(n);
      };

      const normalizeBoolean = (value) => {
        return typeof value === "boolean" ? value : null;
      };

      const getOptionNameByPosition = (options = [], position) => {
        const found = options.find((o) => Number(o?.position) === position);
        return normalizeNullableString(found?.name);
      };

      const getOptionValueByIndex = (selectedOptions = [], index) => {
        if (!Array.isArray(selectedOptions) || !selectedOptions[index]) return null;
        return normalizeNullableString(selectedOptions[index]?.value);
      };

      const extractCollections = (collections) => {
        if (!collections) return [];
        if (Array.isArray(collections)) return collections;
        if (Array.isArray(collections.edges)) {
          return collections.edges
            .map((edge) => edge?.node)
            .filter(Boolean)
            .map((node) => ({
              id: node.id,
              title: node.title,
            }));
        }
        return [];
      };

      const extractVariants = (variants) => {
        if (!variants) return [];
        if (Array.isArray(variants)) return variants;
        if (Array.isArray(variants.edges)) {
          return variants.edges.map((edge) => edge?.node).filter(Boolean);
        }
        return [];
      };

     

      const flattenProduct = (product) => {
        const options = Array.isArray(product.options) ? product.options : [];
        const variants = Array.isArray(product.variants) ? product.variants : [];

        return {
          shop,
          id: product.id,
          title: product.title ?? "",
          handle: normalizeNullableString(product.handle),
          status: product.status ?? "DRAFT",
          productType: normalizeNullableString(product.productType),
          vendor: normalizeNullableString(product.vendor),
          tags: Array.isArray(product.tags) ? product.tags : [],
          templateSuffix: normalizeNullableString(product.templateSuffix),
          description: normalizeNullableString(product.descriptionHtml),
          createdAt: product.createdAt ? new Date(product.createdAt) : null,
          updatedAt: product.updatedAt ? new Date(product.updatedAt) : null,
          publishedAt: product.publishedAt ? new Date(product.publishedAt) : null,
          seoTitle: normalizeNullableString(product.seo?.title),
          seoDescription: normalizeNullableString(product.seo?.description),
          totalInventory: normalizeNullableInt(product.totalInventory) ?? 0,
          categoryId: normalizeNullableString(product.category?.id),
          categoryName: normalizeNullableString(product.category?.name),
          featuredImageUrl: normalizeNullableString(product.featuredMedia?.preview?.image?.url),
          featuredImageAltText: normalizeNullableString(
            product.featuredMedia?.alt || product.featuredMedia?.preview?.image?.altText
          ),
          optionsJson: options,
          collectionsJson: Array.isArray(product.collections) ? product.collections : [],
          option1Name: getOptionNameByPosition(options, 1),
          option2Name: getOptionNameByPosition(options, 2),
          option3Name: getOptionNameByPosition(options, 3),
          variantCount: variants.length,
          visibleOnlineStore: !!product.onlineStoreUrl,
          // visiblePos: false, // requires publication-channel-specific sync if you want exact POS truth
        };
      };

      const flattenVariant = (productId, variant) => {
        const price = normalizeNullableFloat(variant.price);
        const cost = normalizeNullableFloat(variant.inventoryItem?.unitCost?.amount);

        let profitMargin = null;
        if (price !== null && cost !== null && price > 0) {
          profitMargin = Number((((price - cost) / price) * 100).toFixed(2));
        }

        const selectedOptions = Array.isArray(variant.selectedOptions)
          ? variant.selectedOptions
          : [];

       

        return {
          shop,
          id: variant.id,
          productId,
          title: normalizeNullableString(variant.title),
          sku: normalizeNullableString(variant.sku),
          barcode: normalizeNullableString(variant.barcode),
          price,
          compareAtPrice: normalizeNullableFloat(variant.compareAtPrice),
          cost,
          inventoryQuantity: normalizeNullableInt(variant.inventoryQuantity),
          inventoryPolicy: normalizeNullableString(variant.inventoryPolicy),
          taxable: normalizeBoolean(variant.taxable),
          taxCode: normalizeNullableString(variant.taxCode),
          weight: normalizeNullableFloat(
            variant.inventoryItem?.measurement?.weight?.value
          ),
          weightUnit: normalizeNullableString(
            variant.inventoryItem?.measurement?.weight?.unit
          ),
          countryOfOrigin: normalizeNullableString(
            variant.inventoryItem?.countryCodeOfOrigin
          ),
          hsTariffCode: normalizeNullableString(
            variant.inventoryItem?.harmonizedSystemCode
          ),
          position: normalizeNullableInt(variant.position),
          selectedOptionsJson: selectedOptions,
          option1Value: getOptionValueByIndex(selectedOptions, 0),
          option2Value: getOptionValueByIndex(selectedOptions, 1),
          option3Value: getOptionValueByIndex(selectedOptions, 2),
          tracked: normalizeBoolean(variant.inventoryItem?.tracked),
          physicalProduct: normalizeBoolean(variant.inventoryItem?.requiresShipping),
          profitMargin,
        };
      };

      const flushProductsAndVariants = async () => {
        if (productBatch.length === 0) return;

        const currentProducts = productBatch;
        productBatch = [];

        const productRows = [];
        const variantRows = [];

        for (const rawProduct of currentProducts) {
          productRows.push(flattenProduct(rawProduct));

          const rawVariants = Array.isArray(rawProduct.variants) ? rawProduct.variants : [];
          for (const rawVariant of rawVariants) {
            if (!rawVariant?.id) continue;
            variantRows.push(flattenVariant(rawProduct.id, rawVariant));
          }
        }

        await prisma.$transaction([
          prisma.product.createMany({
            data: productRows,
            skipDuplicates: true,
          }),
          prisma.variant.createMany({
            data: variantRows,
            skipDuplicates: true,
          }),
        ]);

        totalProductsProcessed += productRows.length;
        totalVariantsProcessed += variantRows.length;

        if (totalProductsProcessed > 0 && totalProductsProcessed % 5000 === 0) {
          await prisma.store.update({
            where: { shopUrl: shop },
            data: {
              productInitialSyncProgress: totalProductsProcessed,
            },
          });
        }
      };

      const rl = readline.createInterface({
        input: dataStream,
        crlfDelay: Infinity,
      });

      rl.on("line", (line) => {
        if (!line.trim()) return;

        try {
          const json = JSON.parse(line);

          if (!json.__parentId && json.__typename === "Product") {
            if (!productsMap.has(json.id)) {
              productsMap.set(json.id, {
                ...json,
                variants: extractVariants(json.variants),
                collections: extractCollections(json.collections),
                options: Array.isArray(json.options) ? json.options : [],
                featuredMedia: json.featuredMedia || null,
              });
            }
            return;
          }

          const parent = productsMap.get(json.__parentId);
          if (!parent) return;

          switch (json.__typename) {
            case "ProductVariant":
              parent.variants.push({
                id: json.id,
                title: json.title,
                sku: json.sku,
                barcode: json.barcode,
                price: json.price,
                compareAtPrice: json.compareAtPrice,
                inventoryQuantity: json.inventoryQuantity,
                inventoryPolicy: json.inventoryPolicy,
                taxable: json.taxable,
                taxCode: json.taxCode,
                position: json.position,
                selectedOptions: Array.isArray(json.selectedOptions) ? json.selectedOptions : [],
                inventoryItem: json.inventoryItem || null,
              });
              break;

            case "Collection":
              parent.collections.push({
                id: json.id,
                title: json.title,
              });
              break;

            case "MediaImage":
              parent.featuredMedia = json;
              break;

            default:
              break;
          }
        } catch (err) {
          console.error("❌ Line parse error:", err.message);
        }
      });

      rl.on("close", async () => {
        try {
          if (replaceShopData) {
            await prisma.variant.deleteMany({ where: { shop } });
            await prisma.product.deleteMany({ where: { shop } });
          }

          for (const product of productsMap.values()) {
            productBatch.push(product);

            if (productBatch.length >= PRODUCT_BATCH_SIZE) {
              await flushProductsAndVariants();
            }
          }

          await flushProductsAndVariants();

          console.log(
            `✅ Product+Variant sync completed. products=${totalProductsProcessed} variants=${totalVariantsProcessed}`
          );

          resolve({
            totalProductsProcessed,
            totalVariantsProcessed,
          });
        } catch (err) {
          reject(err);
        }
      });

      rl.on("error", (err) => {
        console.error("❌ Readline error:", err);
        reject(err);
      });
    });
  }
}

