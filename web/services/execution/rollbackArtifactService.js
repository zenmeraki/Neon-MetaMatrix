import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const ROLLBACK_ARTIFACT_ROOT = path.join(process.cwd(), ".runtime", "rollback-artifacts");
const DEFAULT_RETENTION_HOURS = Math.max(
  Number(process.env.ROLLBACK_ARTIFACT_RETENTION_HOURS || 168),
  1,
);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function toJsonLine(row) {
  return `${JSON.stringify(row)}\n`;
}

function normalizeFieldValue(value) {
  if (value && typeof value === "object" && Object.hasOwn(value, "field")) {
    return value.field;
  }
  return value ?? null;
}

export async function createRollbackArtifacts({
  shop,
  operationId,
  intentHash,
  mutations,
}) {
  const timestamp = Date.now();
  const artifactId = `rollback_${operationId}_${timestamp}`;
  const dir = path.join(ROLLBACK_ARTIFACT_ROOT, shop, operationId);
  await fs.mkdir(dir, { recursive: true });

  const forwardPath = path.join(dir, `${artifactId}.forward.jsonl`);
  const rollbackPath = path.join(dir, `${artifactId}.rollback.jsonl`);

  const forwardLines = [];
  const rollbackLines = [];

  for (const mutation of mutations || []) {
    const forward = {
      operationId,
      intentHash,
      productId: mutation.productId,
      variantId: mutation.variantId ?? null,
      field: mutation.field,
      action: mutation.action,
      value: normalizeFieldValue(mutation.afterValueJson),
    };

    const rollback = {
      operationId,
      intentHash,
      productId: mutation.productId,
      variantId: mutation.variantId ?? null,
      field: mutation.field,
      action: "set",
      value: normalizeFieldValue(mutation.beforeValueJson),
    };

    forwardLines.push(toJsonLine(forward));
    rollbackLines.push(toJsonLine(rollback));
  }

  const forwardJsonl = forwardLines.join("");
  const rollbackJsonl = rollbackLines.join("");

  await Promise.all([
    fs.writeFile(forwardPath, forwardJsonl, "utf8"),
    fs.writeFile(rollbackPath, rollbackJsonl, "utf8"),
  ]);

  // Periodic cleanup policy: opportunistically enqueue cleanup on artifact generation.
  const cleanupEveryN = Math.max(Number(process.env.ROLLBACK_ARTIFACT_CLEANUP_EVERY_N_ARTIFACTS || 50), 1);
  if (Math.floor(Math.random() * cleanupEveryN) === 0) {
    const { addRollbackArtifactCleanupJob } = await import(
      "../../jobs/queues/rollbackArtifactCleanupQueue.js"
    );
    await addRollbackArtifactCleanupJob({ reason: "artifact_generation" }).catch(() => {});
  }

  return {
    artifactId,
    rowCount: forwardLines.length,
    forward: {
      path: forwardPath,
      checksum: sha256(forwardJsonl),
    },
    rollback: {
      path: rollbackPath,
      checksum: sha256(rollbackJsonl),
    },
    createdAt: new Date().toISOString(),
  };
}

export async function assertRollbackArtifactsReady({ shop, operationId, planJson }) {
  const artifact = planJson?.rollbackArtifact || null;
  if (!artifact?.forward?.path || !artifact?.rollback?.path) {
    const error = new Error("ROLLBACK_ARTIFACT_REQUIRED");
    error.code = "ROLLBACK_ARTIFACT_REQUIRED";
    error.statusCode = 409;
    throw error;
  }

  const [forwardStat, rollbackStat] = await Promise.all([
    fs.stat(artifact.forward.path).catch(() => null),
    fs.stat(artifact.rollback.path).catch(() => null),
  ]);

  if (!forwardStat || !rollbackStat) {
    const error = new Error("ROLLBACK_ARTIFACT_MISSING");
    error.code = "ROLLBACK_ARTIFACT_MISSING";
    error.statusCode = 409;
    error.details = {
      shop,
      operationId,
      artifactId: artifact.artifactId || null,
    };
    throw error;
  }
}

async function walk(dir, files = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, files);
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

export async function cleanupExpiredRollbackArtifacts({
  rootDir = ROLLBACK_ARTIFACT_ROOT,
  retentionHours = DEFAULT_RETENTION_HOURS,
}) {
  const cutoffMs = Date.now() - Number(retentionHours) * 60 * 60 * 1000;
  const files = await walk(rootDir, []);
  let deletedCount = 0;

  for (const filePath of files) {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) continue;
    if (Number(stat.mtimeMs || 0) < cutoffMs) {
      await fs.unlink(filePath).catch(() => {});
      deletedCount += 1;
    }
  }

  return {
    rootDir,
    retentionHours: Number(retentionHours),
    scannedCount: files.length,
    deletedCount,
    completedAt: new Date().toISOString(),
  };
}

export async function loadRollbackArtifactFromPlan({ planJson }) {
  const artifact = planJson?.rollbackArtifact || null;
  if (!artifact?.rollback?.path) {
    const error = new Error("ROLLBACK_ARTIFACT_REQUIRED");
    error.code = "ROLLBACK_ARTIFACT_REQUIRED";
    error.statusCode = 409;
    throw error;
  }
  const content = await fs.readFile(artifact.rollback.path, "utf8");
  const rows = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  return {
    artifact,
    rows,
  };
}
