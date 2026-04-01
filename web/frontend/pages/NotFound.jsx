import { Card, EmptyState, Page } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { notFoundImage } from "../assets";

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <Page>
      <Card>
        <Card.Section>
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
        </Card.Section>
      </Card>
    </Page>
  );
}
