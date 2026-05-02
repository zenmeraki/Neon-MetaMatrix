//web/utils/errorUtils.js
import crypto from "crypto";

// Custom error classes
export class ValidationError extends Error {
  constructor(message, userMessage = null) {
    super(message);
    this.name = "ValidationError";
    this.statusCode = 400;
    this.userMessage = userMessage || message;
  }
}

export class NotFoundError extends Error {
  constructor(message, userMessage = null) {
    super(message);
    this.name = "NotFoundError";
    this.statusCode = 404;
    this.userMessage = userMessage || message;
  }
}

export default class CustomError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    Error.captureInlineStackTrace(this, this.constructor);
  }
}

export const queryOptionsValidation = [
  "equals",
  "does not equal",
  "contains",
  "does not contain",
  "contains any of the words",
  "starts with",
  "does not start with",
  "ends with",
  "is empty/blank",
  "equals (case insensitive)",
  "contains (case insensitive)",
];
// Generate unique error ID for tracking
export const generateErrorId = () => {
  return crypto.randomBytes(8).toString("hex");
};

// Sanitize query params for logging
export const sanitizeForLogging = (query) => {
  const result = { ...query };

  // Remove sensitive fields if they exist
  const sensitiveFields = ["password", "token", "secret", "key"];

  for (const field of sensitiveFields) {
    if (result[field]) {
      result[field] = "[REDACTED]";
    }
  }

  return result;
};
