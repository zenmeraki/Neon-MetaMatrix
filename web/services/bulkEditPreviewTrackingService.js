import { prisma } from "../config/database.js";
import logger from "../utils/loggerUtils.js";

export function trackBulkEditPreview({
  shop,
  field,
  editType,
  value,
  lang,
  searchKey,
  replaceText,
  supportValue,
  filterParams,
}) {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  setImmediate(async () => {
    try {
      await prisma.filterTrack.create({
        data: {
          shop,
          previewFilterParams: filterParams,
          type: "preview",
          field,
          editOption: editType,
          value,
          en: lang,
          searchKey,
          replaceText,
          supportValue,
        },
      });
    } catch (error) {
      logger.warn("Failed to persist bulk edit preview tracking", {
        shop,
        field,
        editType,
        message: error.message,
      });
    }
  });
}
