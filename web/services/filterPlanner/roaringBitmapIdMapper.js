import roaring from "roaring";
import { runWorkerTask } from "../../utils/runWorkerTask.js";

const { RoaringBitmap32 } = roaring;

const MAX_UINT32 = 0xffffffff;
const BITMAP_WORKER_THRESHOLD = Math.max(
  Number(process.env.BITMAP_WORKER_THRESHOLD || 5000) || 5000,
  1,
);

function normalizeProductId(productId) {
  const normalized = String(productId || "").trim();

  if (!normalized) {
    throw new Error("productId is required for bitmap mapping");
  }

  return normalized;
}

function assertUint32(value, fieldName = "bitmap id") {
  if (!Number.isInteger(value) || value < 0 || value > MAX_UINT32) {
    throw new Error(`${fieldName} must be an unsigned 32-bit integer`);
  }
}

export function createScopedProductBitmapMapper(productIds = []) {
  if (!Array.isArray(productIds)) {
    throw new Error("productIds must be an array");
  }

  // This mapping is deterministic only for the resolved target set supplied here.
  // Persisted bitmap caches need a DB-backed mapping table keyed by shop + product ID.
  const uniqueProductIds = [...new Set(productIds.map(normalizeProductId))].sort();

  if (uniqueProductIds.length > MAX_UINT32) {
    throw new Error("Too many product IDs for RoaringBitmap32 mapping");
  }

  const productIdToBitmapId = new Map();
  const bitmapIdToProductId = new Map();

  uniqueProductIds.forEach((productId, index) => {
    const bitmapId = index + 1;
    productIdToBitmapId.set(productId, bitmapId);
    bitmapIdToProductId.set(bitmapId, productId);
  });

  return {
    size: uniqueProductIds.length,
    productIds: uniqueProductIds,
    productIdToBitmapId,
    bitmapIdToProductId,
    toBitmapId(productId) {
      const bitmapId = productIdToBitmapId.get(normalizeProductId(productId));

      if (bitmapId === undefined) {
        throw new Error(`Product ID is not present in this bitmap mapping: ${productId}`);
      }

      return bitmapId;
    },
    toProductId(bitmapId) {
      assertUint32(bitmapId);

      const productId = bitmapIdToProductId.get(bitmapId);

      if (!productId) {
        throw new Error(`Bitmap ID is not present in this mapping: ${bitmapId}`);
      }

      return productId;
    },
  };
}

export function productIdsToBitmap(productIds = [], mapper) {
  const effectiveMapper = mapper || createScopedProductBitmapMapper(productIds);
  const bitmapIds = productIds.map((productId) => effectiveMapper.toBitmapId(productId));
  const bitmap = new RoaringBitmap32();

  bitmap.addMany(bitmapIds);

  return {
    bitmap,
    mapper: effectiveMapper,
  };
}

export function bitmapToProductIds(bitmap, mapper) {
  if (!bitmap || typeof bitmap[Symbol.iterator] !== "function") {
    throw new Error("A RoaringBitmap32-compatible bitmap is required");
  }

  if (!mapper?.toProductId) {
    throw new Error("A bitmap mapper is required");
  }

  return [...bitmap].map((bitmapId) => mapper.toProductId(bitmapId));
}

export function serializeProductIdBitmap(productIds = [], mapper) {
  const { bitmap, mapper: effectiveMapper } = productIdsToBitmap(productIds, mapper);

  return {
    serialized: bitmap.serialize(true),
    mapper: effectiveMapper,
  };
}

export async function serializeProductIdBitmapAsync(
  productIds = [],
  mapper,
  options = {},
) {
  const {
    forceWorker = false,
    timeoutMs = 30_000,
  } = options;

  if (mapper || (!forceWorker && productIds.length < BITMAP_WORKER_THRESHOLD)) {
    return serializeProductIdBitmap(productIds, mapper);
  }

  const result = await runWorkerTask(
    new URL("./workers/bitmapSerializationWorker.js", import.meta.url),
    { productIds },
    { timeoutMs },
  );

  return {
    serialized: result.serialized,
    mapper: createScopedProductBitmapMapper(result.mapperProductIds),
  };
}

export function deserializeProductIdBitmap(serialized, mapper) {
  if (!serialized) {
    throw new Error("serialized bitmap is required");
  }

  if (!mapper?.toProductId) {
    throw new Error("A bitmap mapper is required");
  }

  const bitmap = RoaringBitmap32.deserialize(serialized, true);

  return {
    bitmap,
    productIds: bitmapToProductIds(bitmap, mapper),
  };
}
