export async function acquireRedisLock(redis, key, token, ttlSeconds) {
  const result = await redis.set(key, token, "EX", ttlSeconds, "NX");
  return result === "OK";
}

export async function refreshRedisLock(redis, key, token, ttlSeconds) {
  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("EXPIRE", KEYS[1], ARGV[2])
    end
    return 0
  `;
  const result = await redis.eval(script, 1, key, token, String(ttlSeconds));
  return Number(result) === 1;
}

export async function releaseRedisLock(redis, key, token) {
  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    end
    return 0
  `;
  await redis.eval(script, 1, key, token);
}

