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

  useEffect(() => {
    const savedLang = localStorage.getItem("appLanguage");
    i18n.changeLanguage(savedLang || "en");
  }, [i18n]);

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
                {/* <a href="/product-code-snippets">{t("Snippet Studio")}</a> */}
                <a href="/refresh">{t("SyncData")}</a>
                <a href="/spreadsheet">{t("Spreadsheet Edit")}</a>
                <a href="/suggestionpage">{t("Suggestion")}</a>
                <a href="/pricing">{t("Pricing")}</a>
              </>
            )}
          </NavMenu>

          <Routes pages={pages} data={{ setIsSyncing }} />
        </QueryProvider>
      </BrowserRouter>
    </PolarisProvider>
  );
}
