import * as editHistoryRepository from "../repositories/editHistoryRepository.js";

export async function getEditStatusSummary({ id, shop }) {
  if (!id || !shop) {
    return null;
  }

  return editHistoryRepository.findEditStatusSummaryByShop({
    id,
    shop,
  });
}
