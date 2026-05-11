import { GetLocations } from "../../graphql/location.js";
import shopify from "../../shopify.js";
import { getCache, setCache } from "../../utils/cacheUtils.js";

const LOCATION_PAGE_SIZE = 100;
const MAX_LOCATION_PAGES = 50;
const DEFAULT_LOCATION_LIMIT = 50;
const MAX_LOCATION_LIMIT = 250;

function sanitizeLocationSearch(input = "") {
  return String(input).replace(/[():'"]/g, " ").trim().slice(0, 100);
}

function parseLimit(rawLimit) {
  const parsed = Number.parseInt(String(rawLimit ?? DEFAULT_LOCATION_LIMIT), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LOCATION_LIMIT;
  return Math.min(parsed, MAX_LOCATION_LIMIT);
}

function encodeCursor(index) {
  if (!Number.isFinite(index) || index < 0) return null;
  return Buffer.from(`offset:${index}`, "utf8").toString("base64");
}

function decodeCursor(cursor) {
  if (!cursor || typeof cursor !== "string") return 0;
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    if (!decoded.startsWith("offset:")) return 0;
    const offset = Number.parseInt(decoded.slice("offset:".length), 10);
    if (!Number.isFinite(offset) || offset < 0) return 0;
    return offset;
  } catch {
    return 0;
  }
}

function isRetryableShopifyError(error) {
  const statusCode = Number(
    error?.response?.status ||
      error?.status ||
      error?.statusCode ||
      error?.cause?.status
  );
  if (statusCode === 429) return true;
  if (statusCode >= 500 && statusCode < 600) return true;

  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("eai_again")
  );
}

async function withLocationRetry(operation, maxRetries = 2) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxRetries || !isRetryableShopifyError(error)) {
        throw error;
      }
      const delayMs = 250 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      attempt += 1;
    }
  }
  throw new Error("LOCATION_FETCH_RETRY_EXHAUSTED");
}

export class LocationService {
  static inflightLocationFetches = new Map();

  constructor(locationModel) {
    this.Location = locationModel;
  }

  async getLocationsByShop(shop) {
    try {
      const cacheKey = `${shop}:locationsFetch`;
      const cachedData = await getCache(cacheKey);
      if (cachedData) {
        return {
          success: true,
          data: cachedData,
          message: " Locations fetched successfully from cache",
        };
      }

      const locations = await this.Location.find({ shop }).select("name").lean();
      await setCache(cacheKey, locations, 300);
      return {
        success: true,
        data: locations,
        message: " Locations fetched successfully",
      };
    } catch (error) {
      throw new Error("Error fetching locations from database: " + error.message);
    }
  }

  async fetchLocations(session, req) {
    try {
      const client = new shopify.api.clients.Graphql({ session });
      const search = sanitizeLocationSearch(req?.query?.search || "");
      const limit = parseLimit(req?.query?.limit);
      const offset = decodeCursor(req?.query?.cursor);
      const cacheKey = `${session.shop}:locationsFetch:${search}`;
      const cachedData = await getCache(cacheKey);
      if (cachedData) {
        const paged = cachedData.slice(offset, offset + limit);
        const nextOffset = offset + paged.length;
        const hasMore = nextOffset < cachedData.length;
        return {
          success: true,
          total: cachedData.length,
          data: paged,
          pageInfo: {
            hasMore,
            nextCursor: hasMore ? encodeCursor(nextOffset) : null,
          },
        };
      }

      const inflightKey = `${session.shop}:locationsFetchInflight:${search}`;
      const existingInflight = LocationService.inflightLocationFetches.get(
        inflightKey
      );
      if (existingInflight) {
        return existingInflight;
      }

      const fetchPromise = (async () => {
        const locations = [];
        let hasNextPage = true;
        let after = null;
        let pageCount = 0;

        while (hasNextPage && pageCount < MAX_LOCATION_PAGES) {
          const response = await withLocationRetry(() =>
            client.query({
              data: {
                query: GetLocations,
                variables: {
                  search,
                  first: LOCATION_PAGE_SIZE,
                  after,
                },
              },
            })
          );

          const connection = response?.body?.data?.locations;
          const edges = Array.isArray(connection?.edges) ? connection.edges : [];

          for (const edge of edges) {
            const node = edge?.node;
            if (!node?.id || !node?.name) continue;
            if (!node.isActive) continue;

            locations.push({
              id: node.id,
              title: node.name,
              isActive: Boolean(node.isActive),
              fulfillsOnlineOrders: Boolean(node.fulfillsOnlineOrders),
              hasActiveInventory: Boolean(node.hasActiveInventory),
            });
          }

          hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
          after = connection?.pageInfo?.endCursor || null;
          pageCount += 1;
        }

        locations.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        await setCache(cacheKey, locations, 300);

        const paged = locations.slice(offset, offset + limit);
        const nextOffset = offset + paged.length;
        const hasMore = nextOffset < locations.length;

        return {
          success: true,
          total: locations.length,
          data: paged,
          pageInfo: {
            hasMore,
            nextCursor: hasMore ? encodeCursor(nextOffset) : null,
          },
        };
      })();

      LocationService.inflightLocationFetches.set(inflightKey, fetchPromise);
      try {
        return await fetchPromise;
      } finally {
        LocationService.inflightLocationFetches.delete(inflightKey);
      }
    } catch (error) {
      throw new Error("Error fetching locations: " + error.message);
    }
  }
}
