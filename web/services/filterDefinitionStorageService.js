import { prisma } from "../config/database.js";
import {
  normalizeCanonicalFilterParams,
  serializeCanonicalFilterParams,
} from "./productService/productFilterContract.js";

export const FILTER_DEFINITION_VERSION = 1;

const TABLE_CONFIG = {
  RecurringEdit: {
    filterColumn: "filterParams",
  },
  ScheduledExport: {
    filterColumn: "filterParams",
  },
  AutomaticProductRule: {
    filterColumn: "conditions",
  },
};

function getTableConfig(tableName) {
  const config = TABLE_CONFIG[tableName];
  if (!config) {
    throw new Error(`Unsupported filter definition table: ${tableName}`);
  }

  return config;
}

export function buildCanonicalFilterMetadata(filterParams = []) {
  const normalizedFilterParams = normalizeCanonicalFilterParams(filterParams);

  return {
    filterVersion: FILTER_DEFINITION_VERSION,
    canonicalFilterKey: serializeCanonicalFilterParams(normalizedFilterParams),
    normalizedFilterParams,
  };
}

export async function persistFilterDefinitionMetadata({
  tableName,
  id,
  filterParams = [],
}) {
  const { canonicalFilterKey, filterVersion } =
    buildCanonicalFilterMetadata(filterParams);

  getTableConfig(tableName);

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

export async function backfillFilterDefinitionMetadata(tableName) {
  const config = getTableConfig(tableName);
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT "id", "${config.filterColumn}" AS "filterPayload"
      FROM "${tableName}"
      WHERE "canonicalFilterKey" IS NULL
         OR "filterVersion" IS NULL
    `,
  );

  for (const row of rows) {
    try {
      await persistFilterDefinitionMetadata({
        tableName,
        id: row.id,
        filterParams: row.filterPayload ?? [],
      });
    } catch {
      // Leave malformed legacy rows untouched; runtime validators will surface them.
    }
  }

  return rows.length;
}
