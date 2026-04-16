import * as filterTrackingRepository from "../repositories/filterTrackingRepository.js";

export async function recordFilterUsage({
  shop,
  filterParams = {},
  respondProductCount = 0,
  type = "filter",
}) {
  if (!shop || process.env.NODE_ENV !== "production") {
    return null;
  }

  return filterTrackingRepository.createFilterTrack({
    shop,
    filterParams,
    respondProductCount,
    type,
  });
}

export async function recordEditPreviewUsage({
  shop,
  filterParams,
  field,
  editOption,
  value,
  en,
  searchKey,
  replaceText,
  supportValue,
}) {
  if (!shop || process.env.NODE_ENV !== "production") {
    return null;
  }

  return filterTrackingRepository.createFilterTrack({
    shop,
    previewFilterParams: filterParams,
    type: "preview",
    field,
    editOption,
    value,
    en,
    searchKey,
    replaceText,
    supportValue,
  });
}
