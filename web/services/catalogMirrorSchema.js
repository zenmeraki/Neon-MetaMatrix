export const CURRENT_MIRROR_SCHEMA_VERSION = 1;

export function isMirrorSchemaCurrent(version) {
  return Number(version || 0) === CURRENT_MIRROR_SCHEMA_VERSION;
}
