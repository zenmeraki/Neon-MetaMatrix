import { prisma } from "../config/database.js";
import { buildCanonicalFilterMetadata } from "./filterDefinitionStorageService.js";

async function updateTableTargetingMetadata(tableName, id, filterParams = []) {
  const { filterVersion, canonicalFilterKey } =
    buildCanonicalFilterMetadata(filterParams);

  await prisma.$executeRawUnsafe(
    `
      UPDATE "${tableName}"
      SET "filterVersion" = $2,
          "canonicalFilterKey" = $3,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = $1
    `,
    id,
    filterVersion,
    canonicalFilterKey,
  );

  return {
    filterVersion,
    canonicalFilterKey,
  };
}

async function fetchTableTargetingMetadata(tableName, id) {
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT "filterVersion", "canonicalFilterKey"
      FROM "${tableName}"
      WHERE "id" = $1
      LIMIT 1
    `,
    id,
  );

  return rows?.[0]
    ? {
        filterVersion: rows[0].filterVersion ?? null,
        canonicalFilterKey: rows[0].canonicalFilterKey ?? null,
      }
    : {
        filterVersion: null,
        canonicalFilterKey: null,
      };
}

export async function persistEditHistoryTargetingMetadata({
  historyId,
  filterParams = [],
}) {
  return updateTableTargetingMetadata("EditHistory", historyId, filterParams);
}

export async function persistExportJobTargetingMetadata({
  exportJobId,
  filterParams = [],
}) {
  return updateTableTargetingMetadata("ExportJob", exportJobId, filterParams);
}

export async function getEditHistoryTargetingMetadata(historyId) {
  return fetchTableTargetingMetadata("EditHistory", historyId);
}

export async function getExportJobTargetingMetadata(exportJobId) {
  return fetchTableTargetingMetadata("ExportJob", exportJobId);
}

export async function enrichEditHistoriesWithTargetingMetadata(records = []) {
  return Promise.all(
    records.map(async (record) => ({
      ...record,
      ...(record?.id ? await getEditHistoryTargetingMetadata(record.id) : {}),
    })),
  );
}

export async function enrichExportJobsWithTargetingMetadata(records = []) {
  return Promise.all(
    records.map(async (record) => ({
      ...record,
      ...(record?.id ? await getExportJobTargetingMetadata(record.id) : {}),
    })),
  );
}
