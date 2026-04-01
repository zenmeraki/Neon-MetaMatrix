import jwt from "jsonwebtoken";

const SYNC_SOCKET_SCOPE = "sync-realtime";
const SYNC_SOCKET_TOKEN_TTL_SECONDS = 60 * 60;

function getSyncSocketSecret() {
  const secret =
    process.env.SYNC_SOCKET_SECRET ||
    process.env.SHOPIFY_API_SECRET ||
    process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error("Missing sync socket signing secret");
  }

  return secret;
}

export function createSyncSocketToken({ shop }) {
  if (!shop) {
    throw new Error("Shop is required to create a sync socket token");
  }

  return jwt.sign(
    {
      shop,
      scope: SYNC_SOCKET_SCOPE,
    },
    getSyncSocketSecret(),
    {
      expiresIn: SYNC_SOCKET_TOKEN_TTL_SECONDS,
      issuer: "metamatrix-sync",
      subject: shop,
    },
  );
}

export function verifySyncSocketToken(token) {
  const payload = jwt.verify(token, getSyncSocketSecret(), {
    issuer: "metamatrix-sync",
  });

  if (payload?.scope !== SYNC_SOCKET_SCOPE || !payload?.shop) {
    throw new Error("Invalid sync socket token scope");
  }

  return payload;
}

export { SYNC_SOCKET_SCOPE, SYNC_SOCKET_TOKEN_TTL_SECONDS };
