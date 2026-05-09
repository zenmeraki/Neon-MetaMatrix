export function getSessionOrThrow(res) {
  const session = res?.locals?.shopify?.session;
  if (!session?.shop) {
    const error = new Error("Session expired");
    error.statusCode = 403;
    throw error;
  }

  return session;
}
