// web/frontend/components/LoadingPage.jsx
import { Spinner, Text, BlockStack, Box } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { i18n as appI18n } from "../utils/i18nUtils";

export default function LoadingPage() {
  const { t } = useTranslation(undefined, { i18n: appI18n });

  return (
    <Box
      padding="600"
      minHeight="60vh"
      display="flex"
      alignItems="center"
      justifyContent="center"
    >
      <BlockStack align="center" gap="200">
        <Spinner accessibilityLabel={t("loading")} size="large" />
        <Text variant="bodyLg" as="p" tone="subdued">
          {t("loading")}
        </Text>
      </BlockStack>
    </Box>
  );
}
