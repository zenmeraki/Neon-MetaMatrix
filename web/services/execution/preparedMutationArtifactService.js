import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const PREPARED_MUTATION_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".runtime",
  "prepared-mutation-artifacts",
);

const PRODUCT_SET_SCALAR_FIELDS = new Set([
  "title",
  "descriptionHtml",
  "vendor",
  "productType",
  "handle",
  "status",
  "tags",
]);

const PRICE_FIELDS = new Set(["price", "compareAtPrice"]);
const INVENTORY_FIELDS = new Set(["inventoryQuantity"]);
const SEO_FIELDS = new Set(["seoTitle", "seoDescription", "metaTitle", "metaDescription"]);
const TAG_FIELDS = new Set(["tags"]);
const METAFIELD_FIELDS = new Set(["metafield", "metafields"]);
const COALESCING_POLICY = Object.freeze({
  strategy: "last_write_wins",
  deterministicOrder: "mutation_input_order",
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeFieldValue(value) {
  if (value && typeof value === "object" && Object.hasOwn(value, "field")) {
    return value.field;
  }
  return value ?? null;
}

function normalizeMetafieldPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const namespace = String(value.namespace || "").trim();
  const key = String(value.key || "").trim();
  const type = String(value.type || "").trim();

  if (!namespace || !key || !type) return null;

  return {
    namespace,
    key,
    type,
    value: value.value == null ? "" : String(value.value),
  };
}

function getPipelineForMutation(mutation) {
  const field = String(mutation?.field || "").trim();

  if (PRICE_FIELDS.has(field)) return "price";
  if (INVENTORY_FIELDS.has(field)) return "inventory";
  if (SEO_FIELDS.has(field)) return "seo";
  if (TAG_FIELDS.has(field)) return "tag";
  if (METAFIELD_FIELDS.has(field)) return "metafield";
  if (PRODUCT_SET_SCALAR_FIELDS.has(field)) return "productScalar";

  return null;
}

function toPreparedRow(mutation, options = {}) {
  if (!mutation?.productId) return null;
  const field = String(mutation.field || "").trim();
  const pipeline = getPipelineForMutation(mutation);

  if (!pipeline) {
    return {
      skipped: true,
      reason: mutation?.variantId
        ? "VARIANT_MUTATION_NOT_SERIALIZED"
        : "UNSUPPORTED_PRODUCT_SET_FIELD",
      pipeline: null,
    };
  }

  if (pipeline === "productScalar") {
    if (mutation?.variantId) {
      return {
        skipped: true,
        reason: "VARIANT_MUTATION_NOT_SERIALIZED",
        pipeline,
      };
    }

    return {
      row: {
        productSet: {
          id: mutation.productId,
          [field]: normalizeFieldValue(mutation.afterValueJson),
        },
      },
      pipeline,
    };
  }

  if (pipeline === "price") {
    if (!mutation?.variantId) {
      return {
        skipped: true,
        reason: "PRICE_VARIANT_ID_REQUIRED",
        pipeline,
      };
    }

    return {
      row: {
        productSet: {
          id: mutation.productId,
          variants: [
            {
              id: mutation.variantId,
              [field]: normalizeFieldValue(mutation.afterValueJson),
            },
          ],
        },
      },
      pipeline,
    };
  }

  if (pipeline === "inventory") {
    if (!mutation?.variantId) {
      return {
        skipped: true,
        reason: "INVENTORY_VARIANT_ID_REQUIRED",
        pipeline,
      };
    }

    const inventoryLocationId = String(options.inventoryLocationId || "").trim();
    const normalizedInventory = Number(normalizeFieldValue(mutation.afterValueJson));
    if (inventoryLocationId && Number.isFinite(normalizedInventory)) {
      return {
        row: {
          productSet: {
            id: mutation.productId,
            variants: [
              {
                id: mutation.variantId,
                inventoryQuantities: [
                  {
                    locationId: inventoryLocationId,
                    availableQuantity: Math.trunc(normalizedInventory),
                  },
                ],
              },
            ],
          },
        },
        pipeline,
      };
    }

    return {
      row: {
        productSet: {
          id: mutation.productId,
          variants: [
            {
              id: mutation.variantId,
              [field]: normalizeFieldValue(mutation.afterValueJson),
            },
          ],
        },
      },
      pipeline,
    };
  }

  if (pipeline === "seo") {
    if (mutation?.variantId) {
      return {
        skipped: true,
        reason: "SEO_PRODUCT_LEVEL_ONLY",
        pipeline,
      };
    }

    const normalized = normalizeFieldValue(mutation.afterValueJson);
    return {
      row: {
        productSet: {
          id: mutation.productId,
          seo: {
            ...(field === "seoTitle" || field === "metaTitle" ? { title: normalized } : {}),
            ...(field === "seoDescription" || field === "metaDescription"
              ? { description: normalized }
              : {}),
          },
        },
      },
      pipeline,
    };
  }

  if (pipeline === "tag") {
    if (mutation?.variantId) {
      return {
        skipped: true,
        reason: "TAG_PRODUCT_LEVEL_ONLY",
        pipeline,
      };
    }

    const normalized = normalizeFieldValue(mutation.afterValueJson);
    return {
      row: {
        productSet: {
          id: mutation.productId,
          tags: Array.isArray(normalized) ? normalized : [],
        },
      },
      pipeline,
    };
  }

  if (pipeline === "metafield") {
    if (mutation?.variantId) {
      return {
        skipped: true,
        reason: "METAFIELD_PRODUCT_LEVEL_ONLY",
        pipeline,
      };
    }

    const normalized = normalizeMetafieldPayload(normalizeFieldValue(mutation.afterValueJson));
    if (!normalized) {
      return {
        skipped: true,
        reason: "METAFIELD_DESCRIPTOR_REQUIRED",
        pipeline,
      };
    }

    return {
      row: {
        productSet: {
          id: mutation.productId,
          metafields: [normalized],
        },
      },
      pipeline,
    };
  }

  return {
    skipped: true,
    reason: "UNSUPPORTED_PRODUCT_SET_FIELD",
    pipeline: null,
  };
}

function mergeRows(rows) {
  const conflictSummary = {
    totalConflicts: 0,
    byScope: {
      product: 0,
      seo: 0,
      variant: 0,
      metafield: 0,
    },
    samples: [],
  };
  const recordConflict = ({ scope, productId, key }) => {
    conflictSummary.totalConflicts += 1;
    if (Object.hasOwn(conflictSummary.byScope, scope)) {
      conflictSummary.byScope[scope] += 1;
    }
    if (conflictSummary.samples.length < 20) {
      conflictSummary.samples.push({ scope, productId, key });
    }
  };

  const mergeVariantRows = (existing = [], incoming = [], productId) => {
    const variantMap = new Map();
    for (const variant of existing) {
      if (variant?.id) variantMap.set(variant.id, { ...variant });
    }
    for (const variant of incoming) {
      if (!variant?.id) continue;
      const previous = variantMap.get(variant.id) || {};
      for (const [field, value] of Object.entries(variant)) {
        if (
          field !== "id" &&
          Object.hasOwn(previous, field) &&
          JSON.stringify(previous[field]) !== JSON.stringify(value)
        ) {
          recordConflict({
            scope: "variant",
            productId,
            key: `${variant.id}.${field}`,
          });
        }
      }
      variantMap.set(variant.id, { ...previous, ...variant, id: variant.id });
    }
    return Array.from(variantMap.values());
  };

  const mergeMetafields = (existing = [], incoming = [], productId) => {
    const metafieldMap = new Map();
    for (const item of existing) {
      const key = `${item?.namespace || ""}:${item?.key || ""}`;
      if (key !== ":") metafieldMap.set(key, { ...item });
    }
    for (const item of incoming) {
      const key = `${item?.namespace || ""}:${item?.key || ""}`;
      if (key === ":") continue;
      const previous = metafieldMap.get(key) || {};
      if (
        Object.keys(previous).length > 0 &&
        JSON.stringify(previous) !== JSON.stringify(item)
      ) {
        recordConflict({
          scope: "metafield",
          productId,
          key,
        });
      }
      metafieldMap.set(key, { ...previous, ...item });
    }
    return Array.from(metafieldMap.values());
  };

  const byProductId = new Map();
  for (const row of rows) {
    const productId = row?.productSet?.id;
    if (!productId) continue;

    const existing = byProductId.get(productId)?.productSet || {};
    const incoming = row.productSet || {};
    for (const [field, value] of Object.entries(incoming)) {
      if (["id", "variants", "seo", "metafields"].includes(field)) continue;
      if (Object.hasOwn(existing, field) && JSON.stringify(existing[field]) !== JSON.stringify(value)) {
        recordConflict({ scope: "product", productId, key: field });
      }
    }
    if (existing.seo && incoming.seo) {
      for (const [field, value] of Object.entries(incoming.seo || {})) {
        if (Object.hasOwn(existing.seo, field) && JSON.stringify(existing.seo[field]) !== JSON.stringify(value)) {
          recordConflict({ scope: "seo", productId, key: field });
        }
      }
    }
    byProductId.set(productId, {
      productSet: {
        ...existing,
        ...incoming,
        ...(existing.seo || incoming.seo
          ? { seo: { ...(existing.seo || {}), ...(incoming.seo || {}) } }
          : {}),
        ...(Array.isArray(existing.variants) || Array.isArray(incoming.variants)
          ? {
              variants: mergeVariantRows(
                Array.isArray(existing.variants) ? existing.variants : [],
                Array.isArray(incoming.variants) ? incoming.variants : [],
                productId,
              ),
            }
          : {}),
        ...(Array.isArray(existing.metafields) || Array.isArray(incoming.metafields)
          ? {
              metafields: mergeMetafields(
                Array.isArray(existing.metafields) ? existing.metafields : [],
                Array.isArray(incoming.metafields) ? incoming.metafields : [],
                productId,
              ),
            }
          : {}),
        id: productId,
      },
    });
  }
  return {
    mergedRows: Array.from(byProductId.values()),
    conflictSummary,
  };
}

function resolvePreparedMutationFormat({ pipelineStats = {}, skippedCount = 0, options = {} }) {
  const keys = Object.keys(pipelineStats);
  if (
    keys.length === 1 &&
    keys[0] === "inventory" &&
    skippedCount === 0 &&
    String(options.inventoryLocationId || "").trim()
  ) {
    return "shopify.bulkMutationVariables.inventoryQuantities.productSet.v1";
  }

  return "shopify.bulkMutationVariables.productSet.v1";
}

export function buildPreparedMutationRows(mutations = [], options = {}) {
  const rows = [];
  const skipped = [];
  const pipelineStats = {};

  for (const mutation of Array.isArray(mutations) ? mutations : []) {
    const result = toPreparedRow(mutation, options);
    if (result?.pipeline) {
      pipelineStats[result.pipeline] = (pipelineStats[result.pipeline] || 0) + 1;
    }

    if (result?.row) {
      rows.push(result.row);
      continue;
    }

    skipped.push({
      productId: mutation?.productId || null,
      variantId: mutation?.variantId || null,
      field: mutation?.field || null,
      reason:
        result?.reason ||
        (mutation?.variantId
          ? "VARIANT_MUTATION_NOT_SERIALIZED"
          : "UNSUPPORTED_PRODUCT_SET_FIELD"),
      pipeline: result?.pipeline || null,
    });
  }

  const { mergedRows, conflictSummary } = mergeRows(rows);

  return {
    rows: mergedRows,
    skipped,
    pipelineStats,
    conflictSummary,
    coalescingPolicy: COALESCING_POLICY,
    format: resolvePreparedMutationFormat({
      pipelineStats,
      skippedCount: skipped.length,
      options,
    }),
  };
}

export async function createPreparedMutationArtifact({
  shop,
  operationId,
  intentHash,
  mutations,
  operation,
}) {
  const { rows, skipped, pipelineStats, conflictSummary, coalescingPolicy, format } =
    buildPreparedMutationRows(mutations, {
    inventoryLocationId: operation?.locationId || operation?.location_id || null,
  });
  if (!rows.length) {
    return {
      prepared: false,
      reason: "NO_SUPPORTED_MUTATIONS",
      rowCount: 0,
      skippedCount: skipped.length,
      skippedSample: skipped.slice(0, 20),
      pipelineStats,
      conflictSummary,
      coalescingPolicy,
    };
  }

  const artifactId = `prepared_${operationId}_${Date.now()}`;
  const dir = path.join(PREPARED_MUTATION_ARTIFACT_ROOT, shop, operationId);
  await fs.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, `${artifactId}.shopify.jsonl`);
  const jsonl = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  await fs.writeFile(filePath, jsonl, "utf8");

  return {
    prepared: true,
    artifactId,
    operationId,
    intentHash,
    path: filePath,
    checksum: sha256(jsonl),
    rowCount: rows.length,
    skippedCount: skipped.length,
    skippedSample: skipped.slice(0, 20),
    pipelineStats,
    conflictSummary,
    coalescingPolicy,
    mimeType: "text/jsonl",
    format,
    createdAt: new Date().toISOString(),
  };
}

export async function assertPreparedMutationArtifactReady({ artifact }) {
  if (!artifact?.prepared) {
    const error = new Error("PREPARED_MUTATION_ARTIFACT_REQUIRED");
    error.code = "PREPARED_MUTATION_ARTIFACT_REQUIRED";
    error.statusCode = 409;
    error.details = {
      reason: artifact?.reason || null,
      skippedCount: artifact?.skippedCount ?? null,
    };
    throw error;
  }

  if (Number(artifact.skippedCount || 0) > 0) {
    const error = new Error("PREPARED_MUTATION_ARTIFACT_PARTIAL");
    error.code = "PREPARED_MUTATION_ARTIFACT_PARTIAL";
    error.statusCode = 409;
    error.details = {
      artifactId: artifact.artifactId || null,
      skippedCount: Number(artifact.skippedCount || 0),
      skippedSample: artifact.skippedSample || [],
    };
    throw error;
  }

  const content = await fs.readFile(artifact.path, "utf8").catch(() => null);
  if (!content) {
    const error = new Error("PREPARED_MUTATION_ARTIFACT_MISSING");
    error.code = "PREPARED_MUTATION_ARTIFACT_MISSING";
    error.statusCode = 409;
    error.details = {
      artifactId: artifact.artifactId || null,
    };
    throw error;
  }

  const checksum = sha256(content);
  const rowCount = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;

  if (checksum !== artifact.checksum || rowCount !== Number(artifact.rowCount || 0)) {
    const error = new Error("PREPARED_MUTATION_ARTIFACT_CHECKSUM_MISMATCH");
    error.code = "PREPARED_MUTATION_ARTIFACT_CHECKSUM_MISMATCH";
    error.statusCode = 409;
    error.details = {
      artifactId: artifact.artifactId || null,
      expectedChecksum: artifact.checksum || null,
      actualChecksum: checksum,
      expectedRowCount: Number(artifact.rowCount || 0),
      actualRowCount: rowCount,
    };
    throw error;
  }

  return {
    path: artifact.path,
    checksum,
    rowCount,
  };
}
