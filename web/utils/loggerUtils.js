const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "accesstoken",
  "access_token",
  "token",
  "password",
  "secret",
  "apikey",
  "api_key",
]);

function sanitizeLogMeta(value, depth = 0) {
  if (depth > 4) {
    return "[truncated]";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return value.length > 1000 ? `${value.slice(0, 1000)}...[truncated]` : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 30).map((item) => sanitizeLogMeta(item, depth + 1));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .map(([key, entry]) => [
          key,
          SENSITIVE_KEYS.has(String(key).toLowerCase())
            ? "[redacted]"
            : sanitizeLogMeta(entry, depth + 1),
        ]),
    );
  }

  return String(value);
}

const formatLog = (level, message, meta) => {
  const time = new Date().toISOString();
  const sanitizedMeta = sanitizeLogMeta(meta);
  const metaString =
    sanitizedMeta && Object.keys(sanitizedMeta).length
      ? ` | meta: ${JSON.stringify(sanitizedMeta)}`
      : "";
  return `[${time}] [${level.toUpperCase()}] ${message}${metaString}`;
};

const logger = {
  info: (message, meta = {}) => console.log(formatLog("info", message, meta)),
  warn: (message, meta = {}) => console.warn(formatLog("warn", message, meta)),
  error: (message, meta = {}) => {
    if (message instanceof Error) {
      return console.error(
        formatLog("error", message.message, {
          stack: message.stack,
          ...meta,
        }),
      );
    }

    if (typeof message === "object") {
      return console.error(
        formatLog("error", JSON.stringify(sanitizeLogMeta(message)), meta),
      );
    }

    return console.error(formatLog("error", message, meta));
  },

  debug: (message, meta = {}) =>
    console.debug(formatLog("debug", message, meta)),
};

export const removeStripHtmlTags = (html) => {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "").trim();
};

export default logger;
