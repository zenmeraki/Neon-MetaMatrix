import { BrowserRouter } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { NavMenu } from "@shopify/app-bridge-react";
import Routes from "./Routes";

import { QueryProvider, PolarisProvider } from "./components";

import "./app.css";
import { useEffect, useState } from "react";
import ProductSync from "./components/ProductSyncProgress";

export default function App() {
  // Load all pages eagerly (no lazy routing)
  const [isSyncing, setIsSyncing] = useState(false);
  const pages = import.meta.glob("./pages/**/!(*.test.[jt]sx)*.([jt]sx)", {
    eager: true,
  });
  const { t, i18n } = useTranslation();

    /* ===============================
     LOAD SAVED LANGUAGE (ONLY)
     No browser detection
  =============================== */
  useEffect(() => {
    const savedLang = localStorage.getItem("appLanguage");
    if (savedLang) {
      i18n.changeLanguage(savedLang);
    } else {
      i18n.changeLanguage("en"); // default
    }
  }, [i18n]);

  // useEffect(() => {
  //   const browserLang = navigator.language || navigator.userLanguage;
  //   const langCode = browserLang.split("-")[0];
  //   i18n.changeLanguage(langCode || "en");
  // }, []);

  return (
    <PolarisProvider>
      <BrowserRouter>
        <QueryProvider>
          <NavMenu>
            <a href="/" rel="home">
              {t("Home")}
            </a>
            {!isSyncing && (
              <>
                <a href="/products">{t("Products")}</a>
                <a href="/history">{t("History")}</a>
                <a href="/refresh">{t("SyncData")}</a>
                <a href="/spreadsheet">{t("Spreadsheet Edit")}</a>
                {/* <a href="/subscription">{t("Subscription")}</a> */}
                <a href="/suggestionpage">{t("Suggestion")}</a>
                <a href="/pricing">{t("Pricing")}</a>
              </>
            )}
            {/* <a href="/privacypolicy">{t("Privacy")}</a> */}
            {/* <a href="/intelligence">{t("Intelligence")}</a> */}
          </NavMenu>

          <Routes pages={pages} data={{ setIsSyncing }} />
        </QueryProvider>
      </BrowserRouter>
    </PolarisProvider>
  );
}
