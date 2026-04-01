import fs from "fs";
import path from "path";

const root = process.cwd();
const frontendRoot = path.join(root);
const localeDir = path.join(frontendRoot, "locales");
const sourceFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === "src"
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
      sourceFiles.push(fullPath);
    }
  }
}

function flattenKeys(value, prefix = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    return flattenKeys(nestedValue, nextPrefix);
  });
}

function collectTranslationKeys(fileContent) {
  const keys = [];
  const pattern = /\bt\(\s*["'`]([^"'`]+)["'`]/g;
  let match;

  while ((match = pattern.exec(fileContent))) {
    if (!match[1].includes("${")) {
      keys.push(match[1]);
    }
  }

  return keys;
}

walk(frontendRoot);

const localeFiles = fs
  .readdirSync(localeDir)
  .filter((file) => file.endsWith(".json"))
  .sort();

const localeKeySets = new Map(
  localeFiles.map((file) => {
    const content = JSON.parse(
      fs.readFileSync(path.join(localeDir, file), "utf8"),
    );
    return [file, new Set(flattenKeys(content))];
  }),
);

const baseLocale = "en.json";
const baseKeys = localeKeySets.get(baseLocale);

if (!baseKeys) {
  throw new Error(`Missing base locale file: ${baseLocale}`);
}

const missingFromBase = new Map();

for (const file of sourceFiles) {
  const content = fs.readFileSync(file, "utf8");

  for (const key of collectTranslationKeys(content)) {
    if (!baseKeys.has(key)) {
      if (!missingFromBase.has(key)) {
        missingFromBase.set(key, new Set());
      }

      missingFromBase.get(key).add(path.relative(frontendRoot, file));
    }
  }
}

const missingByLocale = new Map();

for (const [localeFile, keySet] of localeKeySets.entries()) {
  if (localeFile === baseLocale) continue;

  const missing = [...baseKeys].filter((key) => !keySet.has(key));
  if (missing.length) {
    missingByLocale.set(localeFile, missing);
  }
}

let hasFailures = false;

if (missingFromBase.size) {
  hasFailures = true;
  console.error("Missing keys in en.json:");
  for (const [key, files] of missingFromBase.entries()) {
    console.error(`- ${key}`);
    for (const file of files) {
      console.error(`  used in ${file}`);
    }
  }
}

if (missingByLocale.size) {
  console.warn("Locale files missing keys from en.json:");
  for (const [localeFile, keys] of missingByLocale.entries()) {
    console.warn(`- ${localeFile}: ${keys.length} missing keys`);
  }
}

if (hasFailures) {
  process.exitCode = 1;
} else {
  console.log("i18n validation passed.");
}
