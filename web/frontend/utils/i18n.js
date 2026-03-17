import i18n from "i18next";
import { initReactI18next } from "react-i18next";
// import LanguageDetector from "i18next-browser-languagedetector"; 

import en from "../locales/en.json";
import es from "../locales/es.json";
import fr from "../locales/fr.json";
import de from "../locales/de.json";
import pt from "../locales/pt.json";
import ar from "../locales/ar.json";
import hi from "../locales/hi.json";
import zh from "../locales/zh.json";
import ja from "../locales/ja.json";
import ko from "../locales/ko.json";
import ru from "../locales/ru.json";

i18n
.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    fr: { translation: fr },
    de: { translation: de },
    pt: { translation: pt },
    ar: { translation: ar },
    hi: { translation: hi },
    zh: { translation: zh },
    ja: { translation: ja },
    ko: { translation: ko },
    ru: { translation: ru },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
