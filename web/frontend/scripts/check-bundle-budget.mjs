import fs from "fs";
import path from "path";
import zlib from "zlib";

const DIST_DIR = path.resolve("dist");
const INDEX_HTML = path.join(DIST_DIR, "index.html");
const MAX_INITIAL_JS_GZIP_BYTES = 250 * 1024;

function fail(message) {
  console.error(`[bundle-budget] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(INDEX_HTML)) {
  fail("Missing dist/index.html. Run `npm run build` first.");
}

const html = fs.readFileSync(INDEX_HTML, "utf8");
const initialAssetPaths = new Set();

const scriptRegex = /<script[^>]*type="module"[^>]*src="([^"]+)"/g;
const preloadRegex = /<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g;

for (const regex of [scriptRegex, preloadRegex]) {
  let match = null;
  while ((match = regex.exec(html)) !== null) {
    const href = String(match[1] || "");
    if (!href.endsWith(".js")) continue;
    const normalized = href.startsWith("/") ? href.slice(1) : href;
    initialAssetPaths.add(normalized);
  }
}

if (initialAssetPaths.size === 0) {
  fail("Could not detect initial JS assets from dist/index.html.");
}

let totalGzipBytes = 0;
const rows = [];

for (const relPath of initialAssetPaths) {
  const absPath = path.join(DIST_DIR, relPath);
  if (!fs.existsSync(absPath)) {
    fail(`Missing asset referenced by index.html: ${relPath}`);
  }
  const content = fs.readFileSync(absPath);
  const gzipBytes = zlib.gzipSync(content).length;
  totalGzipBytes += gzipBytes;
  rows.push({ relPath, gzipBytes });
}

rows.sort((a, b) => b.gzipBytes - a.gzipBytes);

console.log("[bundle-budget] Initial JS assets (gzip):");
for (const row of rows) {
  console.log(
    ` - ${row.relPath}: ${(row.gzipBytes / 1024).toFixed(1)} KB`
  );
}
console.log(
  `[bundle-budget] Total initial JS gzip: ${(totalGzipBytes / 1024).toFixed(1)} KB`
);
console.log(
  `[bundle-budget] Budget: ${(MAX_INITIAL_JS_GZIP_BYTES / 1024).toFixed(1)} KB`
);

if (totalGzipBytes > MAX_INITIAL_JS_GZIP_BYTES) {
  fail(
    `Initial JS bundle exceeds budget by ${(
      (totalGzipBytes - MAX_INITIAL_JS_GZIP_BYTES) /
      1024
    ).toFixed(1)} KB`
  );
}

console.log("[bundle-budget] PASS");
