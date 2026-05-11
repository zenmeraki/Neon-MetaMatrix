export function maintenanceModeMiddleware(req, res, next) {
  const enabled = String(process.env.MAINTENANCE_MODE || "").toLowerCase() === "true";
  if (!enabled) {
    return next();
  }

  const isReadOnlyMethod = req.method === "GET" || req.method === "HEAD";
  if (isReadOnlyMethod) {
    return next();
  }

  return res.status(503).json({
    error: "MAINTENANCE_MODE_ACTIVE",
    message: "Write operations are temporarily disabled during maintenance.",
  });
}

