import { GetLocations } from "../../graphql/location.js";
import { getCache, setCache } from "../../utils/cacheUtils.js";
import { adminGraphqlWithRetry } from "../../utils/shopifyAdminApi.js";

export class LocationService {
  constructor(locationModel) {
    this.Location = locationModel;
  }

  async getLocationsByShop(shop) {
    try {
      const cacheKey = `${shop}:locationsFetch`;
      // Check cache first (assuming a CacheService is available)
      const cachedData = await getCache(cacheKey);
      if (cachedData) {
        return {
          success: true,
          data: cachedData,
          message: " Locations fetched successfully from cache",
        };
      }

      const locations = await this.Location.find({ shop })
        .select("name")
        .lean();
      await setCache(cacheKey, locations, 300); // Cache for 1 hour
      return {
        success: true,
        data: locations,
        message: " Locations fetched successfully",
      };
    } catch (error) {
      throw new Error(
        "Error fetching locations from database: " + error.message
      );
    }
  }

  async fetchLocations(session, req) {
    try {
      const search = req?.query?.search || "";
      const cacheKey = `${session.shop}:locationsFetch:${search}`;
      // Check cache first
      const cachedData = await getCache(cacheKey);
      if (cachedData) {
        return {
          success: true,
          total: cachedData.length,
          data: cachedData, // [{ id, title }]
        };
      }

      const response = await adminGraphqlWithRetry({
        session,
        shop: session?.shop,
        operationName: "fetchLocations",
        data: {
          query: GetLocations,
          variables: { search },
        },
      });

      const locations =
        response?.body?.data?.locations?.edges?.map(({ node }) => ({
          id: node.id,
          title: node.name, // ✅ rename name → title
        })) || [];
      await setCache(cacheKey, locations, 300); 

      return {
        success: true,
        total: locations.length,
        data: locations, // [{ id, title }]
      };
    } catch (error) {
      console.error("Error fetching locations:", error);
      throw new Error("Error fetching locations: " + error.message);
    }
  }
}
