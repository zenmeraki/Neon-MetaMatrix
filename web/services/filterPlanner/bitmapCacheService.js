import crypto from "crypto";
import { redisClient } from "../../config/redis.js";
import {
  createScopedProductBitmapMapper,
  deserializeProductIdBitmap,
  serializeProductIdBitmapAsync,
} from "./roaringBitmapIdMapper.js";

const BITMAP_CACHE_TTL_SECONDS = Math.max(
  Number(process.env.BITMAP_CACHE_TTL_SECONDS || 300) || 300,
  1,
);
const BITMAP_CACHE_MAX_PRODUCT_IDS = Math.max(
  Number(process.env.BITMAP_CACHE_MAX_PRODUCT_IDS || 100000) || 100000,
  1,
);

function stripAstMetadata(node) {
  if (Array.isArray(node)) {
    return node.map(stripAstMetadata);
  }

  if (!node || typeof node !== "object") {
    return node;
  }

  const result = {};

  for (const key of Object.keys(node).sort()) {
    if (key === "meta" || key === "optimizer") {
      continue;
    }

    result[key] = stripAstMetadata(node[key]);
  }

  return result;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function buildBitmapCacheKey({ shop, mirrorBatchId, ast, operation }) {
  const hash = crypto
    .createHash("sha256")
    .update(
      stableStringify({
        shop,
        mirrorBatchId,
        operation,
        ast: stripAstMetadata(ast),
      }),
    )
    .digest("hex");

  return `bitmap-cache:${shop}:${mirrorBatchId}:${operation}:${hash}`;
}

export const bitmapCacheService = {
  maxProductIds: BITMAP_CACHE_MAX_PRODUCT_IDS,

  buildKey(args) {
    return buildBitmapCacheKey(args);
  },

  async get({ shop, mirrorBatchId, ast, operation }) {
    const key = buildBitmapCacheKey({ shop, mirrorBatchId, ast, operation });

    try {
      const raw = await redisClient.get(key);

      if (!raw) {
        return null;
      }

      const payload = JSON.parse(raw);
      const orderedProductIds = Array.isArray(payload?.orderedProductIds)
        ? payload.orderedProductIds.filter(Boolean)
        : [];

      if (!orderedProductIds.length || !payload?.serializedBase64) {
        return null;
      }

      const mapper = createScopedProductBitmapMapper(orderedProductIds);
      const { bitmap } = deserializeProductIdBitmap(
        Buffer.from(payload.serializedBase64, "base64"),
        mapper,
      );

      return {
        key,
        count: Number(payload.count) || orderedProductIds.length,
        orderedProductIds,
        bitmap,
        mapper,
      };
    } catch {
      return null;
    }
  },

  async set({ shop, mirrorBatchId, ast, operation, productIds = [] }) {
    const orderedProductIds = [...new Set((Array.isArray(productIds) ? productIds : []).filter(Boolean))]
      .sort();

    if (!orderedProductIds.length) {
      return false;
    }

    if (orderedProductIds.length > BITMAP_CACHE_MAX_PRODUCT_IDS) {
      return false;
    }

    const key = buildBitmapCacheKey({ shop, mirrorBatchId, ast, operation });
    const { serialized, mapper } = await serializeProductIdBitmapAsync(
      orderedProductIds,
    );

    const payload = JSON.stringify({
      count: mapper.size,
      orderedProductIds: mapper.productIds,
      serializedBase64: Buffer.from(serialized).toString("base64"),
    });

    await redisClient.setEx(key, BITMAP_CACHE_TTL_SECONDS, payload);
    return true;
  },
};
