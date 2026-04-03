import crypto from "crypto";
import { prisma } from "../config/database.js";

function normalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.keys(value)
      .sort()
      .reduce((accumulator, key) => {
        accumulator[key] = normalizeValue(value[key]);
        return accumulator;
      }, {});
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

export function stableStringify(value) {
  return JSON.stringify(normalizeValue(value));
}

export function createIdempotencyFingerprint(scope, payload) {
  return crypto
    .createHash("sha256")
    .update(`${scope}:${stableStringify(payload)}`)
    .digest("hex");
}

export async function tryAdvisoryLock(client, lockKey, transactional = false) {
  if (transactional) {
    const rows = await client.$queryRaw`
      SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS locked
    `;
    return Boolean(rows?.[0]?.locked);
  }

  const rows = await client.$queryRaw`
    SELECT pg_try_advisory_lock(hashtext(${lockKey})) AS locked
  `;
  return Boolean(rows?.[0]?.locked);
}

export async function releaseAdvisoryLock(client, lockKey) {
  if (!lockKey) {
    return;
  }

  await client.$queryRaw`
    SELECT pg_advisory_unlock(hashtext(${lockKey}))
  `;
}

export async function withAdvisoryLock(lockKey, fn) {
  let locked = false;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    locked = await tryAdvisoryLock(prisma, lockKey, false);
    if (locked) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (!locked) {
    return {
      locked: false,
      result: null,
    };
  }

  try {
    return {
      locked: true,
      result: await fn(),
    };
  } finally {
    await releaseAdvisoryLock(prisma, lockKey).catch(() => {});
  }
}
