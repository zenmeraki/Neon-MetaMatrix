const buildToken = () => {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
};

const RELEASE_IF_TOKEN_MATCHES = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  end
  return 0
`;

const RENEW_IF_TOKEN_MATCHES = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ARGV[2])
  end
  return 0
`;

export async function acquireRedisLock(connection, key, ttlMs) {
  const token = buildToken();
  const result = await connection.set(key, token, "NX", "PX", ttlMs);

  return {
    acquired: result === "OK",
    key,
    token,
    ttlMs,
  };
}

export async function renewRedisLock(connection, lock, ttlMs = lock?.ttlMs) {
  if (!lock?.key || !lock?.token || !ttlMs) {
    return false;
  }

  const result = await connection.eval(
    RENEW_IF_TOKEN_MATCHES,
    1,
    lock.key,
    lock.token,
    String(ttlMs),
  );

  return Number(result) === 1;
}

export async function releaseRedisLock(connection, lock) {
  if (!lock?.key || !lock?.token) {
    return false;
  }

  const result = await connection.eval(
    RELEASE_IF_TOKEN_MATCHES,
    1,
    lock.key,
    lock.token,
  );

  return Number(result) === 1;
}
