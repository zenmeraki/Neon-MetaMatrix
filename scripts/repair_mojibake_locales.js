const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const LOCALES = {
  ar: {
    file: "web/frontend/locales/ar.json",
    ranges: [[0x0600, 0x06ff], [0x0750, 0x077f], [0x08a0, 0x08ff]],
  },
  hi: {
    file: "web/frontend/locales/hi.json",
    ranges: [[0x0900, 0x097f]],
  },
  zh: {
    file: "web/frontend/locales/zh.json",
    ranges: [[0x3400, 0x4dbf], [0x4e00, 0x9fff]],
  },
  ru: {
    file: "web/frontend/locales/ru.json",
    ranges: [[0x0400, 0x04ff]],
  },
  ja: {
    file: "web/frontend/locales/ja.json",
    ranges: [[0x3040, 0x309f], [0x30a0, 0x30ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff]],
  },
};

const MOJIBAKE_HINTS = ["Ã", "Â", "Ð", "Ñ", "Ø", "Ù", "à", "æ", "ç", "ä", "å", "ï"];

function inRanges(char, ranges) {
  const code = char.codePointAt(0);
  return ranges.some(([start, end]) => code >= start && code <= end);
}

function scoreString(value, ranges) {
  let targetChars = 0;
  let mojibakeChars = 0;
  let controlChars = 0;

  for (const char of value) {
    if (inRanges(char, ranges)) targetChars += 1;
    const code = char.codePointAt(0);
    if ((code >= 0x00 && code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0xfffd) {
      controlChars += 3;
    }
  }

  for (const hint of MOJIBAKE_HINTS) {
    if (value.includes(hint)) mojibakeChars += 2;
  }

  return targetChars - mojibakeChars - controlChars;
}

function decodeLatin1AsUtf8(value) {
  return Buffer.from(value, "latin1").toString("utf8");
}

function pickBestRepair(value, ranges) {
  if (![...value].every((char) => char.codePointAt(0) <= 0xff)) {
    return value;
  }

  const hasHint = MOJIBAKE_HINTS.some((hint) => value.includes(hint));
  if (!hasHint) {
    return value;
  }

  const decoded = decodeLatin1AsUtf8(value);
  const originalScore = scoreString(value, ranges);
  const decodedScore = scoreString(decoded, ranges);

  return decodedScore > originalScore ? decoded : value;
}

function repairValue(value, ranges, stats) {
  if (typeof value === "string") {
    const repaired = pickBestRepair(value, ranges);
    if (repaired !== value) stats.fixed += 1;
    return repaired;
  }

  if (Array.isArray(value)) {
    return value.map((item) => repairValue(item, ranges, stats));
  }

  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      value[key] = repairValue(value[key], ranges, stats);
    }
  }

  return value;
}

function mergeMissingKeys(baseValue, currentValue) {
  if (Array.isArray(baseValue) || Array.isArray(currentValue)) {
    return currentValue !== undefined ? currentValue : baseValue;
  }

  if (baseValue && typeof baseValue === "object" && currentValue && typeof currentValue === "object") {
    const merged = { ...baseValue };
    for (const key of Object.keys(currentValue)) {
      if (key in merged) {
        merged[key] = mergeMissingKeys(merged[key], currentValue[key]);
      } else {
        merged[key] = currentValue[key];
      }
    }
    return merged;
  }

  return currentValue !== undefined ? currentValue : baseValue;
}

for (const [locale, config] of Object.entries(LOCALES)) {
  const filePath = path.resolve(config.file);
  const currentRaw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const currentParsed = JSON.parse(currentRaw);
  const headRaw = execFileSync("git", ["show", `HEAD:${config.file.replace(/\\/g, "/")}`], {
    encoding: "utf8",
  }).replace(/^\uFEFF/, "");
  const headParsed = JSON.parse(headRaw);
  const stats = { fixed: 0 };
  const repairedHead = repairValue(headParsed, config.ranges, stats);
  const merged = mergeMissingKeys(repairedHead, currentParsed);

  fs.writeFileSync(filePath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  console.log(`${locale}: fixed ${stats.fixed} value(s)`);
}
