import crypto from "crypto";
import { getCache, setCache } from "../../utils/cacheUtils.js";

const HOT_QUERY_CACHE_TTL_SECONDS = 120;

function stableNormalize(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableNormalize(item));
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableNormalize(value[key]);
        return result;
      }, {});
  }

  return value;
}

export function hashHotQueryPart(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableNormalize(value)))
    .digest("hex");
}

export function buildHotQueryCacheKey({
  shop,
  catalogBatchId,
  namespace,
  ast,
  page,
  limit,
  sort,
  extra = null,
}) {
  return [
    shop,
    "HotProductQuery",
    catalogBatchId,
    namespace,
    hashHotQueryPart({
      ast,
      page,
      limit,
      sort,
      extra,
    }),
  ].join(":");
}

export async function getHotQueryCache(key) {
  return getCache(key);
}

export async function setHotQueryCache(
  key,
  data,
  ttl = HOT_QUERY_CACHE_TTL_SECONDS,
) {
  return setCache(key, data, ttl);
}
