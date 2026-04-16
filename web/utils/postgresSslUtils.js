const SSL_MODE_PARAM = "sslmode";

export function normalizePostgresConnectionString(connectionString) {
  if (!connectionString) {
    return connectionString;
  }

  const shouldRequireSsl =
    /neon\.tech/i.test(connectionString) &&
    !new RegExp(`[?&]${SSL_MODE_PARAM}=`, "i").test(connectionString);

  if (!shouldRequireSsl) {
    return connectionString;
  }

  const separator = connectionString.includes("?") ? "&" : "?";
  return `${connectionString}${separator}${SSL_MODE_PARAM}=require`;
}
