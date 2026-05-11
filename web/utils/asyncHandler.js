// web/utils/asyncHandler.js
import { generateErrorId } from './errorUtils.js';
import logger from './loggerUtils.js';
import { errorResponse } from './responseUtils.js';

/**
 * Wraps controller functions to handle async errors uniformly
 * @param {Function} fn - The async controller function to wrap
 * @returns {Function} Express middleware function that handles errors
 */
export const asyncHandler = (fn) => {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      const errorId = generateErrorId();

      const statusCode = err.statusCode || 500;
      const userMessage = err.userMessage || "An unexpected error occurred. Please try again later.";
      const errorData = process.env.NODE_ENV === 'development' 
        ? { details: err.message, id: errorId } 
        : { id: errorId };
  // Log the error details using Winston
      logger.error({
        errorId,
        message: err.message,
        stack: err.stack,
        statusCode,
        path: req.originalUrl,
        method: req.method,
        shop: res.locals?.shopify?.session?.shop || 'unknown-shop',
      });
      // Create the standard error response
      const response = errorResponse(userMessage, errorData);
      
      // Add the type field that your frontend expects
      if (err.type) {
        response.type = err.type;
      } else {
        response.type = 'FETCH'; // Default error type
      }

      res.status(statusCode).json(response);
    }
  };
};