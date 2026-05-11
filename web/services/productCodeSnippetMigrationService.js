const CURRENT_SNIPPET_SCHEMA_VERSION = 1;
const CURRENT_VALIDATOR_VERSION = 1;

function codedError(code, message = code, meta = undefined) {
  const error = new Error(message);
  error.code = code;
  if (meta !== undefined) error.meta = meta;
  return error;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractSnapshot(normalizedAst) {
  if (isObject(normalizedAst) && isObject(normalizedAst.__meta) && normalizedAst.ast) {
    return {
      ast: normalizedAst.ast,
      meta: normalizedAst.__meta,
    };
  }

  // Legacy payload shape: AST only
  return {
    ast: normalizedAst || null,
    meta: {
      schemaVersion: 0,
      validatorVersion: 0,
      migratedFromLegacy: true,
    },
  };
}

function migrateV0ToV1(snapshot) {
  return {
    __meta: {
      ...(snapshot.meta || {}),
      schemaVersion: 1,
      validatorVersion: CURRENT_VALIDATOR_VERSION,
      migratedAt: new Date().toISOString(),
      migrationVersion: "v0_to_v1",
    },
    ast: snapshot.ast || {},
  };
}

export function migrateProductSnippetSnapshot(normalizedAst) {
  const snapshot = extractSnapshot(normalizedAst);
  const fromVersion = Number(snapshot.meta?.schemaVersion || 0);

  if (!snapshot.ast || !isObject(snapshot.ast)) {
    throw codedError("SNIPPET_MIGRATION_INVALID_AST");
  }

  let migrated = false;
  let current = null;

  switch (fromVersion) {
    case 0:
      current = migrateV0ToV1(snapshot);
      migrated = true;
      break;
    case 1:
      current = {
        __meta: {
          ...(snapshot.meta || {}),
          schemaVersion: 1,
          validatorVersion:
            snapshot.meta?.validatorVersion || CURRENT_VALIDATOR_VERSION,
        },
        ast: snapshot.ast,
      };
      break;
    default:
      throw codedError("SNIPPET_SCHEMA_VERSION_UNSUPPORTED", undefined, {
        fromVersion,
        currentSupportedVersion: CURRENT_SNIPPET_SCHEMA_VERSION,
      });
  }

  return {
    migrated,
    fromVersion,
    toVersion: CURRENT_SNIPPET_SCHEMA_VERSION,
    normalizedAst: current,
  };
}

export { CURRENT_SNIPPET_SCHEMA_VERSION, CURRENT_VALIDATOR_VERSION };

