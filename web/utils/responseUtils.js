//web/utils/responseUtils.js
/**
 * Creates a standardized API response object
 * @param {boolean} success - Whether the operation was successful
 * @param {string} message - Human-readable message about the operation
 * @param {any} data - The payload/data being returned
 * @param {Object} [meta] - Optional metadata about the response (pagination, limits, etc.)
 * @returns {Object} Standardized response object
 */
export const createResponse = (success, message, data, meta = null) => {
  const response = {
    success,
    message,
    data
  };
  
  if (meta) {
    response.meta = meta;
  }
  
  return response;
};

/**
 * Creates a success response
 * @param {string} message - Success message
 * @param {any} data - The payload/data being returned
 * @param {Object} [meta] - Optional metadata about the response
 * @returns {Object} Standardized success response
 */
export const successResponse = (message, data, meta = null) => {
  return createResponse(true, message, data, meta);
};

/**
 * Creates an error response
 * @param {string} message - Error message
 * @param {any} [data=null] - Optional error details
 * @param {Object} [meta=null] - Optional metadata about the error
 * @returns {Object} Standardized error response
 */
export const errorResponse = (message, data = null, meta = null) => {
  return createResponse(false, message, data, meta);
};