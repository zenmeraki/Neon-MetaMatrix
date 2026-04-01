import { useEffect, useState } from "react";
import { AppProvider } from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";
import { Link as RouterLink } from "react-router-dom";
import {
  getCachedPolarisTranslations,
  getPolarisTranslations,
  i18n,
} from "../../utils/i18nUtils";
import { openTopLevelUrl } from "../../utils/embeddedNavigation";

function AppBridgeLink({ url, children, external, ...rest }) {
  const IS_EXTERNAL_LINK_REGEX = /^(?:[a-z][a-z\d+.-]*:|\/\/)/;

  if (external || IS_EXTERNAL_LINK_REGEX.test(url)) {
    const target = rest.target === "_top" ? "_top" : "_blank";

    return (
      <a
        {...rest}
        href={url}
        target={target}
        rel="noopener noreferrer"
        onClick={(event) => {
          if (target === "_top") {
            event.preventDefault();
            openTopLevelUrl(url);
          }
        }}
      >
        {children}
      </a>
    );
  }

  return (
    <RouterLink {...rest} to={url}>
      {children}
    </RouterLink>
  );
}

/**
 * Sets up the AppProvider from Polaris.
 * @desc PolarisProvider passes a custom link component to Polaris.
 * The Link component handles navigation within an embedded app.
 * Prefer using this vs any other method such as an anchor.
 * Use it by importing Link from Polaris, e.g:
 *
 * ```
 * import {Link} from '@shopify/polaris'
 *
 * function MyComponent() {
 *  return (
 *    <div><Link url="/tab2">Tab 2</Link></div>
 *  )
 * }
 * ```
 *
 * PolarisProvider also passes translations to Polaris.
 *
 */
export function PolarisProvider({ children }) {
  const [translations, setTranslations] = useState(() =>
    getCachedPolarisTranslations(),
  );

  useEffect(() => {
    let active = true;

    const loadTranslations = async (locale) => {
      const nextTranslations = await getPolarisTranslations(locale);

      if (active) {
        setTranslations(nextTranslations);
      }
    };

    loadTranslations(i18n.resolvedLanguage || i18n.language);

    const handleLanguageChange = (locale) => {
      loadTranslations(locale);
    };

    i18n.on("languageChanged", handleLanguageChange);

    return () => {
      active = false;
      i18n.off("languageChanged", handleLanguageChange);
    };
  }, []);

  if (!translations) {
    return null;
  }

  return (
    <AppProvider i18n={translations} linkComponent={AppBridgeLink}>
      {children}
    </AppProvider>
  );
}
