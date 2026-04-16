// web/frontend/components/LoadingPage.jsx
import { Spinner, Text, BlockStack, Box } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

export default function LoadingPage() {
  const { t } = useTranslation();

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
