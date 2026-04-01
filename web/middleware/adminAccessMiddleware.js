function getAllowedAdminShops() {
  return new Set(
    String(process.env.ADMIN_ALLOWED_SHOPS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function requireAdminAccess(req, res, next) {
  const session = res.locals.shopify?.session;
  const shop = session?.shop || null;
  const allowedAdminShops = getAllowedAdminShops();

  if (!shop) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  if (allowedAdminShops.size === 0 || !allowedAdminShops.has(shop)) {
    return res.status(403).json({
      success: false,
      message: "Forbidden",
    });
  }

  return next();
}

export default requireAdminAccess;
