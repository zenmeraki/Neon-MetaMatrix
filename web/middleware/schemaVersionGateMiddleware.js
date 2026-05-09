import { prisma } from "../config/database.js";
import { Prisma } from "@prisma/client";

const CACHE_TTL_MS = 30_000;
let cached = {
  checkedAt: 0,
  ok: true,
  missing: [],
};

function parseRequiredMigrations() {
  const raw = String(process.env.REQUIRED_PRISMA_MIGRATIONS || "").trim();
  if (!raw) return [];

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function checkRequiredMigrations() {
  const required = parseRequiredMigrations();
  if (!required.length) {
    return { ok: true, missing: [] };
  }

  const rows = await prisma.$queryRaw(
    Prisma.sql`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND migration_name IN (${Prisma.join(
      required.map((migration) => Prisma.sql`${migration}`),
      Prisma.sql`, `,
    )})`,
  );

  const applied = new Set((rows || []).map((row) => String(row.migration_name)));
  const missing = required.filter((name) => !applied.has(name));

  return {
    ok: missing.length === 0,
    missing,
  };
}

export async function schemaVersionGateMiddleware(req, res, next) {
  const isReadOnlyMethod = req.method === "GET" || req.method === "HEAD";
  if (isReadOnlyMethod) {
    return next();
  }

  const now = Date.now();
  if (now - cached.checkedAt > CACHE_TTL_MS) {
    cached.checkedAt = now;
    cached = {
      checkedAt: now,
      ...(await checkRequiredMigrations()),
    };
  }

  if (cached.ok) {
    return next();
  }

  return res.status(503).json({
    error: "SCHEMA_VERSION_GATE_BLOCKED",
    message: "Required database migrations are not fully applied.",
    missingMigrations: cached.missing,
  });
}
