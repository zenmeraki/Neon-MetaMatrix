// web/utils/loggerUtils.js

const formatLog = (level, message, meta) => {
  const time = new Date().toISOString();
  const metaString =
    meta && Object.keys(meta).length ? ` | meta: ${JSON.stringify(meta)}` : "";
  return `[${time}] [${level.toUpperCase()}] ${message}${metaString}`;
};

const logger = {
  info: (message, meta = {}) => console.log(formatLog("info", message, meta)),
  warn: (message, meta = {}) => console.warn(formatLog("warn", message, meta)),
 error: (message, meta = {}) => {
  if (message instanceof Error) {
    // Print full error stack + message
    return console.error(
      formatLog("error", message.message, {
        stack: message.stack,
        ...meta,
      })
    );
  }

  // If it's an object, stringify it
  if (typeof message === "object") {
    return console.error(
      formatLog("error", JSON.stringify(message, null, 2), meta)
    );
  }

  // Otherwise print normally
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


