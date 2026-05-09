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
import enTranslations from "../locales/en.json";
import enPolarisTranslations from "@shopify/polaris/locales/en.json";

const DEFAULT_APP_LOCALE = "en";

const SUPPORTED_APP_LOCALES = [
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

const POLARIS_FILTER_ADD_LABELS = {
  en: "Add filter",
  de: "Filter hinzuf\u00fcgen",
  fr: "Ajouter un filtre",
  es: "Agregar filtro",
  ar: "\u0625\u0636\u0627\u0641\u0629 \u0639\u0627\u0645\u0644 \u062a\u0635\u0641\u064a\u0629",
  hi: "\u092b\u093c\u093f\u0932\u094d\u091f\u0930 \u091c\u094b\u0921\u093c\u0947\u0902",
  ja: "\u30d5\u30a3\u30eb\u30bf\u30fc\u3092\u8ffd\u52a0",
  ko: "\ud544\ud130 \ucd94\uac00",
  pt: "Adicionar filtro",
  ru: "\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0444\u0438\u043b\u044c\u0442\u0440",
  zh: "\u6dfb\u52a0\u7b5b\u9009\u6761\u4ef6",
};

let _userLocale;
let _polarisTranslations = enPolarisTranslations;
let _polarisLoadPromise;
let _intlPolyfillPromise;

function deepMerge(target, source) {
  const output = { ...target };

  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key])
    ) {
      output[key] = deepMerge(target?.[key] || {}, source[key]);
    } else {
      output[key] = source[key];
    }
  }

  return output;
}

function getStoredLocale() {
  try {
    return window.localStorage.getItem("appLanguage");
  } catch {
    return null;
  }
}

export function getUserLocale() {
  if (_userLocale) {
    return _userLocale;
  }

  const url = new URL(window.location.href);
  const storedLocale = getStoredLocale();
  const locale =
    storedLocale || url.searchParams.get("locale") || DEFAULT_APP_LOCALE;

  _userLocale = match([locale], SUPPORTED_APP_LOCALES, DEFAULT_APP_LOCALE);
  return _userLocale;
}

export function getPolarisTranslations() {
  return _polarisTranslations;
}

export async function getPolarisTranslationsForLocale(locale) {
  const defaultPolarisLocale = match(
    [DEFAULT_APP_LOCALE],
    SUPPORTED_POLARIS_LOCALES,
    DEFAULT_POLARIS_LOCALE,
  );

  const polarisLocale = match(
    [locale || DEFAULT_APP_LOCALE],
    SUPPORTED_POLARIS_LOCALES,
    defaultPolarisLocale,
  );

  let translations = enPolarisTranslations;

  try {
    translations = await loadPolarisTranslations(polarisLocale);
  } catch (error) {
    console.warn(
      `[i18n] Failed to load Polaris locale "${polarisLocale}". Falling back to English.`,
      error,
    );
  }

  const localeBase = (locale || DEFAULT_APP_LOCALE).split("-")[0];
  const customPolarisOverrides = POLARIS_FILTER_ADD_LABELS[localeBase]
    ? {
        Polaris: {
          Filters: {
            addFilter: POLARIS_FILTER_ADD_LABELS[localeBase],
          },
        },
      }
    : {};

  _polarisTranslations = deepMerge(translations, customPolarisOverrides);
  return _polarisTranslations;
}

export async function initI18n() {
  await initI18next();

  loadIntlPolyfills().catch((error) => {
    console.warn("[i18n] Failed to load Intl polyfills.", error);
  });

  fetchPolarisTranslations().catch((error) => {
    console.warn("[i18n] Failed to load initial Polaris translations.", error);
  });

  i18next.on("languageChanged", async (lng) => {
    _userLocale = match([lng], SUPPORTED_APP_LOCALES, DEFAULT_APP_LOCALE);
    await getPolarisTranslationsForLocale(_userLocale);
  });

  return i18next;
}

async function loadIntlPolyfills() {
  if (_intlPolyfillPromise) {
    return _intlPolyfillPromise;
  }

  _intlPolyfillPromise = loadIntlPolyfillsOnce();
  return _intlPolyfillPromise;
}

async function loadIntlPolyfillsOnce() {
  if (shouldPolyfillLocale()) {
    await import("@formatjs/intl-locale/polyfill");
  }

  const promises = [];

  if (shouldPolyfillPluralRules(DEFAULT_APP_LOCALE)) {
    await import("@formatjs/intl-pluralrules/polyfill-force");
    promises.push(loadIntlPluralRulesLocaleData(DEFAULT_APP_LOCALE));
  }

  if (
    DEFAULT_APP_LOCALE !== getUserLocale() &&
    shouldPolyfillPluralRules(getUserLocale())
  ) {
    promises.push(loadIntlPluralRulesLocaleData(getUserLocale()));
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
  if (!PLURAL_RULES_LOCALE_DATA[locale]) {
    return null;
  }

  return (await PLURAL_RULES_LOCALE_DATA[locale]()).default;
}

async function initI18next() {
  if (i18next.isInitialized) {
    return i18next;
  }

  return await i18next
    .use(initReactI18next)
    .use(ShopifyFormat)
    .use(localResourcesToBackend())
    .init({
      debug: process.env.NODE_ENV === "development",
      lng: getUserLocale(),
      fallbackLng: DEFAULT_APP_LOCALE,
      supportedLngs: SUPPORTED_APP_LOCALES,
      resources: {
        [DEFAULT_APP_LOCALE]: {
          translation: enTranslations,
        },
      },
      partialBundledLanguages: true,
      load: "languageOnly",
      returnEmptyString: false,
      interpolation: {
        escapeValue: false,
      },
      react: {
        useSuspense: false,
      },
    });
}

function localResourcesToBackend() {
  return resourcesToBackend(async (locale, _namespace) => {
    if (locale === DEFAULT_APP_LOCALE) {
      return enTranslations;
    }

    try {
      return (await import(`../locales/${locale}.json`)).default;
    } catch (error) {
      console.warn(
        `[i18n] Failed to load app locale "${locale}". Falling back to English.`,
        error,
      );
      return enTranslations;
    }
  });
}

async function fetchPolarisTranslations() {
  if (_polarisLoadPromise) {
    return _polarisLoadPromise;
  }

  _polarisLoadPromise = getPolarisTranslationsForLocale(getUserLocale()).finally(
    () => {
      _polarisLoadPromise = null;
    },
  );

  return _polarisLoadPromise;
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
  if (locale === DEFAULT_APP_LOCALE || !POLARIS_LOCALE_DATA[locale]) {
    return enPolarisTranslations;
  }

  return (await POLARIS_LOCALE_DATA[locale]()).default;
}

export { i18next as i18n };
