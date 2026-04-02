import { BrowserRouter } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { NavMenu } from "@shopify/app-bridge-react";
import { useEffect, useState } from "react";
import Routes from "./Routes";
import { QueryProvider, PolarisProvider } from "./components";

import "./app.css";

export default function App() {
  const [isSyncing, setIsSyncing] = useState(false);
  const pages = import.meta.glob("./pages/**/!(*.test.[jt]sx)*.([jt]sx)");
  const { t, i18n } = useTranslation();
  const embeddedSearch = typeof window !== "undefined" ? window.location.search : "";

  const withEmbeddedParams = (path) => `${path}${embeddedSearch || ""}`;

  useEffect(() => {
    const savedLang = localStorage.getItem("appLanguage");
    i18n.changeLanguage(savedLang || i18n.resolvedLanguage || i18n.language || "en");
  }, [i18n]);

  return (
    <PolarisProvider>
      <BrowserRouter>
        <QueryProvider>
          <NavMenu>
            <a href={withEmbeddedParams("/")} rel="home">
              {t("Home")}
            </a>
            {!isSyncing && (
              <>
                <a href={withEmbeddedParams("/products")}>{t("Products")}</a>
                <a href={withEmbeddedParams("/history")}>{t("History")}</a>
                {/* <a href="/product-code-snippets">{t("Snippet Studio")}</a> */}
                <a href={withEmbeddedParams("/refresh")}>{t("SyncData")}</a>
                <a href={withEmbeddedParams("/spreadsheet")}>{t("Spreadsheet Edit")}</a>
                <a href={withEmbeddedParams("/suggestionpage")}>{t("Suggestion")}</a>
                <a href={withEmbeddedParams("/pricing")}>{t("Pricing")}</a>
              </>
            )}
          </NavMenu>

          <Routes pages={pages} data={{ setIsSyncing }} />
        </QueryProvider>
      </BrowserRouter>
    </PolarisProvider>
  );
}
