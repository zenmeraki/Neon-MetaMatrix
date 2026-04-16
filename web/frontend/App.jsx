import { BrowserRouter } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo } from "react";
import Routes from "./Routes";
import { QueryProvider, PolarisProvider } from "./components";
import { NavLink } from "react-router-dom";
import {
  selectIsSyncing,
  selectSetIsSyncing,
  useAppUiStore,
} from "./store/appUiStore";

import "./app.css";

const pages = import.meta.glob("./pages/**/!(*.test.[jt]sx)*.([jt]sx)");

const APP_NAV_ITEMS = [
  { to: "/", labelKey: "Home", end: true },
  { to: "/products", labelKey: "Products" },
  { to: "/history", labelKey: "History" },
  { to: "/refresh", labelKey: "SyncData" },
  { to: "/spreadsheet", labelKey: "Spreadsheet Edit" },
  { to: "/suggestionPage", labelKey: "Suggestion" },
  { to: "/pricing", labelKey: "Pricing" },
];

export default function App() {
  const isSyncing = useAppUiStore(selectIsSyncing);
  const setIsSyncing = useAppUiStore(selectSetIsSyncing);
  const { t, i18n } = useTranslation();
  const routeData = useMemo(() => ({ setIsSyncing }), [setIsSyncing]);

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
          <nav className="app-page-nav" aria-label="App pages">
            {APP_NAV_ITEMS.filter(({ end }) => end || !isSyncing).map(
              ({ to, labelKey, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `app-page-nav-link${isActive ? " app-page-nav-link-active" : ""}`
                  }
                >
                  {t(labelKey)}
                </NavLink>
              ),
            )}
          </nav>

          <Routes pages={pages} data={routeData} />
        </QueryProvider>
      </BrowserRouter>
    </PolarisProvider>
  );
}
