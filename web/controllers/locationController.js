import { LocationService } from "../services/locationService/locationService.js";
import { getSessionOrThrow } from "../utils/sessionShop.js";
import { logApiError } from "../utils/errorLogUtils.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 250;

function parseLimit(raw) {
  const parsed = Number.parseInt(String(raw ?? DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

export async function getAllLocations(req, res) {
  let session;
  try {
    session = getSessionOrThrow(res);
    const locationService = new LocationService();
    const limit = parseLimit(req.query?.limit);
    const cursor = typeof req.query?.cursor === "string" ? req.query.cursor : null;
    const search = typeof req.query?.search === "string" ? req.query.search : "";

    const result = await locationService.fetchLocations(session, {
      query: {
        search,
        limit,
        cursor,
      },
    });

    return res.status(200).json(result);
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "locationController.getAllLocations",
    });

    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch locations",
    });
  }
}
