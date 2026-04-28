import { BrowserRouter } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { NavMenu } from "@shopify/app-bridge-react";
import { useEffect, useState } from "react";
import Routes from "./Routes";
import { QueryProvider, PolarisProvider } from "./components";
import { Link } from "react-router-dom";
import { useAuthenticatedFetch } from "./hooks/useAuthenticatedFetch";

import "./app.css";

export default function App() {
  const [isSyncing, setIsSyncing] = useState(false);
  const pages = import.meta.glob("./pages/**/!(*.test.[jt]sx)*.([jt]sx)");
  const { t, i18n } = useTranslation();
  useAuthenticatedFetch();

  useEffect(() => {
  const savedLang = localStorage.getItem("appLanguage");
  if (savedLang && savedLang !== i18n.language) {
    i18n.changeLanguage(savedLang);
  }
}, []);

  return (
    <PolarisProvider>
      <BrowserRouter>
        <QueryProvider>
         <NavMenu>
  <Link to="/" rel="home">{t("Home")}</Link>
  {!isSyncing && (
    <>
      <Link to="/products">{t("Products")}</Link>
      <Link to="/history">{t("History")}</Link>
      <Link to="/refresh">{t("SyncData")}</Link>
      <Link to="/spreadsheet">{t("Spreadsheet Edit")}</Link>
      <Link to="/suggestionpage">{t("Suggestion")}</Link>
      <Link to="/pricing">{t("Pricing")}</Link>
    </>
  )}
</NavMenu>

          <Routes pages={pages} data={{ setIsSyncing }} />
        </QueryProvider>
      </BrowserRouter>
    </PolarisProvider>
  );
}
