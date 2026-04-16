import express from "express";
import { LocationService } from "../services/locationService/locationService.js";

const router = express.Router();
const locationService = new LocationService(null);

router.get("/get-all", async (req, res) => {
  const session = res.locals?.shopify?.session;

  try {
    if (!session?.shop) {
      return res.status(401).json({
        success: false,
        message: "Shopify session missing",
      });
    }

    const result = await locationService.fetchLocations(session, req);

    return res.status(200).json({
      success: true,
      message: "Locations fetched successfully",
      total: result.total || 0,
      data: result.data || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch locations",
    });
  }
});

export default router;
