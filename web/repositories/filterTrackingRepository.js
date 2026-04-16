import { prisma } from "../Config/database.js";

const getClient = (client = prisma) => client || prisma;

export async function createFilterTrack({
  shop,
  filterParams = {},
  previewFilterParams = null,
  respondProductCount = 0,
  previewResCount = null,
  type = "filter",
  field = null,
  editOption = null,
  value = null,
  en = null,
  searchKey = null,
  replaceText = null,
  supportValue = null,
  client = prisma,
}) {
  const db = getClient(client);

  return db.filterTrack.create({
    data: {
      shop,
      filterParams,
      previewFilterParams,
      respondProductCount,
      previewResCount,
      type,
      field,
      editOption,
      value,
      en,
      searchKey,
      replaceText,
      supportValue,
    },
  });
}
