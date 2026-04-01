// web/frontend/components/GenericErrorFallback.jsx
import React from "react";
import { Card, Button, Text, Box, BlockStack } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { i18n as appI18n } from "../../../utils/i18nUtils";

export default function GenericErrorFallback({ error, resetErrorBoundary }) {
  const { t } = useTranslation(undefined, { i18n: appI18n });
  return (
    <Card>
      <Box padding="400">
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd">
            {t("common.somethingWentWrong", {
              defaultValue: "Something went wrong.",
            })}{" "}
            {process.env.NODE_ENV === "development" && error?.message && (
              <Text as="span" tone="subdued">
                ({error.message})
              </Text>
            )}
          </Text>
          <Box>
            <Button onClick={resetErrorBoundary} size="slim">
              {t("common.retry", { defaultValue: "Retry" })}
            </Button>
          </Box>
        </BlockStack>
      </Box>
    </Card>
  );
}
