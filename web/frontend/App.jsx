import { BrowserRouter } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { NavMenu } from "@shopify/app-bridge-react";
import { useState } from "react";
import Routes from "./Routes";
import { QueryProvider, PolarisProvider } from "./components";
import { i18n as appI18n } from "./utils/i18nUtils";
import { getEmbeddedAppUrl } from "./utils/embeddedNavigation";

import "./app.css";

export default function App() {
  const [isSyncing, setIsSyncing] = useState(false);
  const pages = import.meta.glob("./pages/**/!(*.test.[jt]sx)*.([jt]sx)");
  const { t } = useTranslation(undefined, { i18n: appI18n });

  const navItems = [
    {
      href: getEmbeddedAppUrl("/"),
      label: t("dashboard", { defaultValue: "Dashboard" }),
      rel: "home",
    },
    {
      href: getEmbeddedAppUrl("/products"),
      label: t("products", { defaultValue: "Products" }),
    },
    {
      href: getEmbeddedAppUrl("/history"),
      label: t("history", { defaultValue: "History" }),
    },
    {
      href: getEmbeddedAppUrl("/refresh"),
      label: t("syncData", { defaultValue: "Sync Data" }),
    },
    {
      href: getEmbeddedAppUrl("/spreadsheet"),
      label: t("spreadsheetEdit", { defaultValue: "Spreadsheet Edit" }),
    },
    {
      href: getEmbeddedAppUrl("/suggestionpage"),
      label: t("suggestion", { defaultValue: "Suggestion" }),
    },
    {
      href: getEmbeddedAppUrl("/pricing"),
      label: t("pricing", { defaultValue: "Pricing" }),
    },
  ];

  return (
    <PolarisProvider>
      <BrowserRouter>
        <QueryProvider>
          <NavMenu>
            <a href={navItems[0].href} rel={navItems[0].rel}>
              {navItems[0].label}
            </a>
            {!isSyncing && (
              <>
                {navItems.slice(1).map((item) => (
                  <a key={item.href} href={item.href}>
                    {item.label}
                  </a>
                ))}
              </>
            )}
          </NavMenu>

          <Routes pages={pages} data={{ setIsSyncing }} />
        </QueryProvider>
      </BrowserRouter>
    </PolarisProvider>
  );
}
