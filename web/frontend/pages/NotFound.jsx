import { Card, EmptyState, Page, Box } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { i18n as appI18n } from "../utils/i18nUtils";
import { notFoundImage } from "../assets";

export default function NotFound() {
  const { t } = useTranslation(undefined, { i18n: appI18n });
  return (
    <Page>
      <Card>
        <Box padding="400">
          <EmptyState
            heading={t("NotFound.heading", {
              defaultValue: "Page not found",
            })}
            image={notFoundImage}
          >
            <p>
              {t("NotFound.description", {
                defaultValue:
                  "The page you requested could not be found in this app.",
              })}
            </p>
          </EmptyState>
        </Box>
      </Card>
    </Page>
  );
}
