import { useCallback, useEffect, useState } from "react";
import { AppProvider } from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";
import {
  getPolarisTranslations,
  getPolarisTranslationsForLocale,
  i18n,
} from "../../utils/i18nUtils";

function AppBridgeLink({ url, children, external, ...rest }) {
  const handleClick = useCallback(() => window.open(url), [url]);

  const IS_EXTERNAL_LINK_REGEX = /^(?:[a-z][a-z\d+.-]*:|\/\/)/;

  if (external || IS_EXTERNAL_LINK_REGEX.test(url)) {
    return (
      <a {...rest} href={url} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }

  return (
    <a {...rest} onClick={handleClick}>
      {children}
    </a>
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
    getPolarisTranslations(),
  );

  useEffect(() => {
    let isMounted = true;

    const refreshTranslations = async (lng) => {
      const nextTranslations = await getPolarisTranslationsForLocale(lng);

      if (isMounted) {
        setTranslations(nextTranslations);
      }
    };

    refreshTranslations(i18n.language);
    i18n.on("languageChanged", refreshTranslations);

    return () => {
      isMounted = false;
      i18n.off("languageChanged", refreshTranslations);
    };
  }, []);

  return (
    <AppProvider i18n={translations} linkComponent={AppBridgeLink}>
      {children}
    </AppProvider>
  );
}
