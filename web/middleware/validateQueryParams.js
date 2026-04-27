// web/middleware/validateQueryParams.js

/**
 * Middleware to validate query parameters.
 * 
 * @param {Object} options
 * @param {boolean} [options.allowCursor=false] - If false, blocks requests containing a `cursor` param.
 * @returns {Function} Express middleware function
 */
export const validateQueryParams = ({ allowCursor = false } = {}) => {
  return (req, res, next) => {
    const { cursor } = req.query;

    // ❌ Reject if cursor is present but not allowed
    if (!allowCursor && cursor) {
      return res.status(400).json({
        ok: false,
        message: 'Cursor not allowed for this endpoint',
        error: 'INVALID_QUERY_PARAMETER',
      });
    }

    // ✅ Otherwise, continue to next middleware or controller
    next();
  };
};
