import crypto from "crypto";
import { Translate } from "@google-cloud/translate/build/src/v2/index.js";
import dotenv from "dotenv";
import { getCache, setCache } from "./cacheUtils.js";
dotenv.config();

const LANGUAGES = [
  "en",
  "de",
  "fr",
  "es",
  "ar",
  "hi",
  "zh",
  "ja",
  "ko",
  "pt",
  "ru",
];
const credentials = {
  type: process.env.GCP_TYPE,
  project_id: process.env.GCP_PROJECT_ID,
  private_key_id: process.env.GCP_PRIVATE_KEY_ID,
  private_key: process.env.GCP_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  client_email: process.env.GCP_CLIENT_EMAIL,
  client_id: process.env.GCP_CLIENT_ID,
  auth_uri: process.env.GCP_AUTH_URI,
  token_uri: process.env.GCP_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.GCP_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.GCP_CLIENT_X509_CERT_URL,
  universe_domain: process.env.GCP_UNIVERSE_DOMAIN,
};
const translate = new Translate({
  credentials,
});

function buildTranslationCacheKey(originalTitle) {
  const fingerprint = crypto
    .createHash("sha1")
    .update(String(originalTitle || ""))
    .digest("hex");

  return `translation:title:${fingerprint}`;
}

export const createMultiLanguage = async (originalTitle) => {
  const cacheKey = buildTranslationCacheKey(originalTitle);
  const cached = await getCache(cacheKey);
  if (cached && typeof cached === "object") {
    return cached;
  }

  const translated = { en: originalTitle };

  for (const lang of LANGUAGES) {
    if (lang === "en") continue;

    try {
      const [translation] = await translate.translate(originalTitle, lang);
      translated[lang] = translation;
    } catch (err) {
      // throw new Error(`Translation failed for ${lang}: ${err.message}`);
    }
  }

  await setCache(cacheKey, translated, 24 * 3600).catch(() => {});
  return translated;
};

export const createMultiLanguageForFileEdit =  (originalTitle) => {
  const translated = { en: originalTitle };
  for (const lang of LANGUAGES) {
    if (lang === "en") continue;
    try {
      translated[lang] = originalTitle;
    } catch (err) {
      // throw new Error(`Translation failed for ${lang}: ${err.message}`);
    }
  }
  return translated;
};
