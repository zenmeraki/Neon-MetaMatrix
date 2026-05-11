import { productSavedSegmentRepository } from "../repositories/productSavedSegmentRepository.js";
import { stableHash } from "../utils/idempotencyKey.js";
import { logApiError } from "../utils/errorLogUtils.js";

const MAX_SEGMENT_NAME_LENGTH = 120;
const MAX_FILTER_CLAUSES = 50;
const MAX_FILTER_BODY_BYTES = 64 * 1024;
const MAX_DESTINATIONS = 25;
const MAX_DESTINATION_LENGTH = 80;
const MAX_SEARCH_LENGTH = 120;
const MAX_SORT_KEY_LENGTH = 64;
const SEGMENT_VERSION = 1;
const SEGMENT_ID_PATTERN = /^[a-z0-9]{20,40}$/i;
const ALLOWED_SORT_KEYS = new Set([
  "ID",
  "TITLE",
  "CREATED_AT",
  "UPDATED_AT",
  "PRICE",
  "INVENTORY",
]);
const ALLOWED_SORT_ORDERS = new Set(["asc", "desc"]);

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, MAX_SEGMENT_NAME_LENGTH);
}

function normalizeSearch(search) {
  return String(search || "").trim().slice(0, MAX_SEARCH_LENGTH);
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJson(entry));
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        const next = canonicalizeJson(value[key]);
        if (next !== undefined) acc[key] = next;
        return acc;
      }, {});
  }
  if (typeof value === "string") return value.trim();
  return value;
}

function sanitizeFilters(filters) {
  const safe = Array.isArray(filters) ? filters : [];
  if (safe.length > MAX_FILTER_CLAUSES) {
    const error = new Error("FILTER_COMPLEXITY_LIMIT_EXCEEDED");
    error.statusCode = 400;
    throw error;
  }
  const canonical = safe.map((item) => canonicalizeJson(item || {}));
  const bytes = Buffer.byteLength(JSON.stringify(canonical), "utf8");
  if (bytes > MAX_FILTER_BODY_BYTES) {
    const error = new Error("FILTER_PAYLOAD_TOO_LARGE");
    error.statusCode = 400;
    throw error;
  }
  return canonical;
}

function sanitizeDestinations(destinations) {
  if (!Array.isArray(destinations)) return [];
  const normalized = [];
  const seen = new Set();
  for (const value of destinations) {
    const item = String(value || "").trim().slice(0, MAX_DESTINATION_LENGTH);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
    if (normalized.length >= MAX_DESTINATIONS) break;
  }
  return normalized;
}

function sanitizeSort(sort) {
  if (!sort || typeof sort !== "object") return null;
  const key = String(sort.key || sort.sortKey || "").trim().toUpperCase();
  const order = String(sort.order || sort.sortOrder || "asc").trim().toLowerCase();
  if (!key) return null;
  if (key.length > MAX_SORT_KEY_LENGTH || !ALLOWED_SORT_KEYS.has(key)) {
    const error = new Error("INVALID_SORT_KEY");
    error.statusCode = 400;
    throw error;
  }
  if (!ALLOWED_SORT_ORDERS.has(order)) {
    const error = new Error("INVALID_SORT_ORDER");
    error.statusCode = 400;
    throw error;
  }
  return { key, order };
}

function buildSegmentFingerprint({ filters, search, sort, destinations }) {
  return stableHash({
    version: SEGMENT_VERSION,
    filters,
    search,
    sort: sort || null,
    destinations,
  });
}

function attachSegmentMeta(filters, meta) {
  return {
    version: SEGMENT_VERSION,
    clauses: filters,
    meta,
  };
}

export async function listProductSavedSegments(req, res) {
  const shop = res.locals.shopify?.session?.shop;
  try {
    if (!shop) {
      return res.status(401).json({ success: false, message: "Shopify session missing" });
    }
    const data = await productSavedSegmentRepository.list(shop);
    res.json({ success: true, data });
  } catch (error) {
    await logApiError({
      shop,
      err: error,
      req,
      source: "productSavedSegmentController.listProductSavedSegments",
    });
    res.status(500).json({ success: false, message: "Failed to list saved segments" });
  }
}

export async function saveProductSavedSegment(req, res) {
  const shop = res.locals.shopify?.session?.shop;
  const { name, filters, search, sort, destinations } = req.body || {};

  try {
    if (!shop) {
      return res.status(401).json({ success: false, message: "Shopify session missing" });
    }

    const normalizedName = normalizeName(name);
    if (!normalizedName) {
      return res.status(400).json({ success: false, message: "Name is required" });
    }
    const canonicalFilters = sanitizeFilters(filters);
    const normalizedSearch = normalizeSearch(search);
    const normalizedSort = sanitizeSort(sort);
    const normalizedDestinations = sanitizeDestinations(destinations);
    const fingerprint = buildSegmentFingerprint({
      filters: canonicalFilters,
      search: normalizedSearch,
      sort: normalizedSort,
      destinations: normalizedDestinations,
    });

    const data = await productSavedSegmentRepository.upsert(shop, {
      name: normalizedName,
      filters: attachSegmentMeta(canonicalFilters, {
        fingerprint,
        canonicalFilterKey: fingerprint,
        filterVersion: SEGMENT_VERSION,
      }),
      search: normalizedSearch,
      sort: normalizedSort,
      destinations: normalizedDestinations,
    });

    res.json({ success: true, data });
  } catch (error) {
    await logApiError({
      shop,
      err: error,
      req,
      source: "productSavedSegmentController.saveProductSavedSegment",
    });
    const statusCode = Number(error?.statusCode) || 500;
    const message =
      error.message === "FILTER_COMPLEXITY_LIMIT_EXCEEDED"
        ? "Too many filter clauses"
        : error.message === "FILTER_PAYLOAD_TOO_LARGE"
          ? "Filter payload too large"
          : error.message === "INVALID_SORT_KEY" || error.message === "INVALID_SORT_ORDER"
            ? "Invalid sort configuration"
            : "Failed to save segment";
    res.status(statusCode).json({ success: false, message });
  }
}

export async function deleteProductSavedSegment(req, res) {
  const shop = res.locals.shopify?.session?.shop;
  try {
    if (!shop) {
      return res.status(401).json({ success: false, message: "Shopify session missing" });
    }
    const id = String(req.params?.id || "").trim();
    if (!SEGMENT_ID_PATTERN.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid segment id" });
    }
    await productSavedSegmentRepository.delete(shop, id);
    res.json({ success: true });
  } catch (error) {
    await logApiError({
      shop,
      err: error,
      req,
      source: "productSavedSegmentController.deleteProductSavedSegment",
    });
    res.status(500).json({ success: false, message: "Failed to delete segment" });
  }
}
