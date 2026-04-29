import logger from "../utils/loggerUtils.js";
import { featureFlags } from "./featureFlagService.js";

function stableJson(value) {
  return JSON.stringify(value, Object.keys(value || {}).sort());
}

export async function runShadowExecution({
  name,
  shop,
  input,
  primary,
  shadow,
  compare = (left, right) => stableJson(left) === stableJson(right),
}) {
  const primaryResult = await primary(input);

  if (featureFlags.shadowBulkEngine && typeof shadow === "function") {
    setImmediate(async () => {
      try {
        const shadowResult = await shadow(input);
        const matched = compare(primaryResult, shadowResult);
        logger.info("Shadow execution compared", {
          name,
          shop,
          matched,
        });
      } catch (error) {
        logger.error("Shadow execution failed", {
          name,
          shop,
          message: error.message,
        });
      }
    });
  }

  return primaryResult;
}
