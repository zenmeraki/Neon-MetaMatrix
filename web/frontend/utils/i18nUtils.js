import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import ShopifyFormat from "@shopify/i18next-shopify";
import resourcesToBackend from "i18next-resources-to-backend";
import { match } from "@formatjs/intl-localematcher";
import { shouldPolyfill as shouldPolyfillLocale } from "@formatjs/intl-locale/should-polyfill";
import { shouldPolyfill as shouldPolyfillPluralRules } from "@formatjs/intl-pluralrules/should-polyfill";
import {
  DEFAULT_LOCALE as DEFAULT_POLARIS_LOCALE,
  SUPPORTED_LOCALES as SUPPORTED_POLARIS_LOCALES,
} from "@shopify/polaris";

export const DEFAULT_APP_LOCALE = "en";
export const APP_LANGUAGE_STORAGE_KEY = "appLanguage";

export const SUPPORTED_APP_LOCALES = [
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

export const APP_LANGUAGE_OPTIONS = [
  { label: "English", value: "en" },
  { label: "Deutsch", value: "de" },
  { label: "Francais", value: "fr" },
  { label: "Espanol", value: "es" },
  { label: "Portugues", value: "pt" },
  { label: "Arabic", value: "ar" },
  { label: "Hindi", value: "hi" },
  { label: "Chinese", value: "zh" },
  { label: "Japanese", value: "ja" },
  { label: "Korean", value: "ko" },
  { label: "Russian", value: "ru" },
];

const LOCALE_ALIASES = {
  "ar-ae": "ar",
  "ar-eg": "ar",
  "de-de": "de",
  "en-us": "en",
  "en-gb": "en",
  "es-es": "es",
  "es-mx": "es",
  "fr-ca": "fr",
  "fr-fr": "fr",
  "hi-in": "hi",
  "ja-jp": "ja",
  "ko-kr": "ko",
  "pt-br": "pt",
  "pt-pt": "pt",
  "ru-ru": "ru",
  "zh-cn": "zh",
  "zh-hans": "zh",
  "zh-hk": "zh",
  "zh-sg": "zh",
  "zh-tw": "zh",
  "zh-hant": "zh",
};

const polarisTranslationsCache = new Map();
let userLocale;
let initPromise;

function normalizeLocale(candidate) {
  if (!candidate || typeof candidate !== "string") {
    return null;
  }

  const trimmed = candidate.trim();

  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/_/g, "-");
  const lower = normalized.toLowerCase();

  return LOCALE_ALIASES[lower] || normalized;
}

function resolveSupportedLocale(...candidates) {
  const normalizedCandidates = candidates
    .map(normalizeLocale)
    .filter(Boolean)
    .flatMap((candidate) => {
      const languageOnly = candidate.split("-")[0];
      return languageOnly && languageOnly !== candidate
        ? [candidate, languageOnly]
        : [candidate];
    });

  return match(
    normalizedCandidates.length ? normalizedCandidates : [DEFAULT_APP_LOCALE],
    SUPPORTED_APP_LOCALES,
    DEFAULT_APP_LOCALE,
  );
}

export function getUserLocale() {
  if (userLocale) {
    return userLocale;
  }

  const url = new URL(window.location.href);
  const urlLocale = url.searchParams.get("locale");
  const storedLocale = window.localStorage.getItem(APP_LANGUAGE_STORAGE_KEY);
  const browserLocale = navigator.language;

  userLocale = resolveSupportedLocale(urlLocale, storedLocale, browserLocale);
  return userLocale;
}

export function getCurrentLocale() {
  return i18next.resolvedLanguage || i18next.language || getUserLocale();
}

export async function initI18n() {
  if (!initPromise) {
    initPromise = (async () => {
      await loadIntlPolyfills();
      const locale = getUserLocale();
      await Promise.all([initI18next(locale), getPolarisTranslations(locale)]);
      syncDocumentLanguage(getCurrentLocale());
    })();
  }

  return initPromise;
}

export async function changeAppLanguage(nextLocale, { persist = true } = {}) {
  const resolvedLocale = resolveSupportedLocale(nextLocale);

  await Promise.all([
    i18next.changeLanguage(resolvedLocale),
    getPolarisTranslations(resolvedLocale),
  ]);

  userLocale = resolvedLocale;

  if (persist) {
    window.localStorage.setItem(APP_LANGUAGE_STORAGE_KEY, resolvedLocale);
  }

  syncDocumentLanguage(resolvedLocale);
  return resolvedLocale;
}

export function getCachedPolarisTranslations(locale = getCurrentLocale()) {
  return polarisTranslationsCache.get(getClosestPolarisLocale(locale));
}

export async function getPolarisTranslations(locale = getCurrentLocale()) {
  const polarisLocale = getClosestPolarisLocale(locale);

  if (!polarisTranslationsCache.has(polarisLocale)) {
    const translations = await loadPolarisTranslations(polarisLocale);
    polarisTranslationsCache.set(polarisLocale, translations);
  }

  return polarisTranslationsCache.get(polarisLocale);
}

async function loadIntlPolyfills() {
  if (shouldPolyfillLocale()) {
    await import("@formatjs/intl-locale/polyfill");
  }

  const locale = getUserLocale();
  const promises = [];

  if (shouldPolyfillPluralRules(DEFAULT_APP_LOCALE)) {
    await import("@formatjs/intl-pluralrules/polyfill-force");
    promises.push(loadIntlPluralRulesLocaleData(DEFAULT_APP_LOCALE));
  }

  if (locale !== DEFAULT_APP_LOCALE && shouldPolyfillPluralRules(locale)) {
    promises.push(loadIntlPluralRulesLocaleData(locale));
  }

  await Promise.all(promises);
}

const PLURAL_RULES_LOCALE_DATA = {
  cs: () => import("@formatjs/intl-pluralrules/locale-data/cs"),
  da: () => import("@formatjs/intl-pluralrules/locale-data/da"),
  de: () => import("@formatjs/intl-pluralrules/locale-data/de"),
  en: () => import("@formatjs/intl-pluralrules/locale-data/en"),
  es: () => import("@formatjs/intl-pluralrules/locale-data/es"),
  fi: () => import("@formatjs/intl-pluralrules/locale-data/fi"),
  fr: () => import("@formatjs/intl-pluralrules/locale-data/fr"),
  it: () => import("@formatjs/intl-pluralrules/locale-data/it"),
  ja: () => import("@formatjs/intl-pluralrules/locale-data/ja"),
  ko: () => import("@formatjs/intl-pluralrules/locale-data/ko"),
  nb: () => import("@formatjs/intl-pluralrules/locale-data/nb"),
  nl: () => import("@formatjs/intl-pluralrules/locale-data/nl"),
  pl: () => import("@formatjs/intl-pluralrules/locale-data/pl"),
  pt: () => import("@formatjs/intl-pluralrules/locale-data/pt"),
  "pt-PT": () => import("@formatjs/intl-pluralrules/locale-data/pt-PT"),
  sv: () => import("@formatjs/intl-pluralrules/locale-data/sv"),
  th: () => import("@formatjs/intl-pluralrules/locale-data/th"),
  tr: () => import("@formatjs/intl-pluralrules/locale-data/tr"),
  vi: () => import("@formatjs/intl-pluralrules/locale-data/vi"),
  zh: () => import("@formatjs/intl-pluralrules/locale-data/zh"),
};

async function loadIntlPluralRulesLocaleData(locale) {
  return (await PLURAL_RULES_LOCALE_DATA[locale]()).default;
}

async function initI18next(locale) {
  if (i18next.isInitialized) {
    return i18next;
  }

  return i18next
    .use(initReactI18next)
    .use(ShopifyFormat)
    .use(localResourcesToBackend())
    .init({
      debug: process.env.NODE_ENV === "development",
      lng: locale,
      fallbackLng: DEFAULT_APP_LOCALE,
      supportedLngs: SUPPORTED_APP_LOCALES,
      defaultNS: "translation",
      ns: ["translation"],
      load: "languageOnly",
      partialBundledLanguages: true,
      interpolation: {
        escapeValue: false,
      },
      react: {
        useSuspense: false,
      },
      saveMissing: process.env.NODE_ENV === "development",
      missingKeyHandler: (_lngs, _ns, key) => {
        if (process.env.NODE_ENV === "development") {
          console.warn(`[i18n] Missing translation key: ${key}`);
        }
      },
    });
}

function localResourcesToBackend() {
  return resourcesToBackend(async (locale) => {
    return (await import(`../locales/${locale}.json`)).default;
  });
}

function getClosestPolarisLocale(locale) {
  const defaultPolarisLocale = match(
    [DEFAULT_APP_LOCALE],
    SUPPORTED_POLARIS_LOCALES,
    DEFAULT_POLARIS_LOCALE,
  );

  return match(
    [normalizeLocale(locale) || DEFAULT_APP_LOCALE],
    SUPPORTED_POLARIS_LOCALES,
    defaultPolarisLocale,
  );
}

function syncDocumentLanguage(locale) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
}

const POLARIS_LOCALE_DATA = {
  cs: () => import("@shopify/polaris/locales/cs.json"),
  da: () => import("@shopify/polaris/locales/da.json"),
  de: () => import("@shopify/polaris/locales/de.json"),
  en: () => import("@shopify/polaris/locales/en.json"),
  es: () => import("@shopify/polaris/locales/es.json"),
  fi: () => import("@shopify/polaris/locales/fi.json"),
  fr: () => import("@shopify/polaris/locales/fr.json"),
  it: () => import("@shopify/polaris/locales/it.json"),
  ja: () => import("@shopify/polaris/locales/ja.json"),
  ko: () => import("@shopify/polaris/locales/ko.json"),
  nb: () => import("@shopify/polaris/locales/nb.json"),
  nl: () => import("@shopify/polaris/locales/nl.json"),
  pl: () => import("@shopify/polaris/locales/pl.json"),
  "pt-BR": () => import("@shopify/polaris/locales/pt-BR.json"),
  "pt-PT": () => import("@shopify/polaris/locales/pt-PT.json"),
  sv: () => import("@shopify/polaris/locales/sv.json"),
  th: () => import("@shopify/polaris/locales/th.json"),
  tr: () => import("@shopify/polaris/locales/tr.json"),
  vi: () => import("@shopify/polaris/locales/vi.json"),
  "zh-CN": () => import("@shopify/polaris/locales/zh-CN.json"),
  "zh-TW": () => import("@shopify/polaris/locales/zh-TW.json"),
};

async function loadPolarisTranslations(locale) {
  return (await POLARIS_LOCALE_DATA[locale]()).default;
}

export { i18next as i18n };
