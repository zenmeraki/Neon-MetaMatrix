import { clearKeyCaches } from "../utils/cacheUtils.js";

export async function clearExportHistoryCaches(shop) {
  await clearKeyCaches(`${shop}:fetchExportHistories`);
}
