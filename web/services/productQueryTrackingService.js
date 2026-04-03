import { prisma } from "../config/database.js";
import logger from "../utils/loggerUtils.js";

export function trackFilterUsage({
  shop,
  filterParams = [],
  respondProductCount = 0,
}) {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  setImmediate(async () => {
    try {
      await prisma.filterTrack.create({
        data: {
          shop,
          filterParams,
          respondProductCount,
          type: "filter",
        },
      });
    } catch (error) {
      logger.warn({
        message: "Failed to record product filter tracking",
        shop,
        source: "productQueryTrackingService",
        error: error.message,
      });
    }
  });
}
