import { Card, Button, Text, Box, BlockStack } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

export default function GenericErrorFallback({ error, resetErrorBoundary }) {
  const { t } = useTranslation();
  const isDevelopment = import.meta.env.DEV;
  const debugMessage = error?.stack ?? error?.message;

  return (
    <Card padding="400">
      <BlockStack gap="300" role="alert">
        <Text as="p" variant="bodyMd">
          {t("common.somethingWentWrong", "Something went wrong.")}
        </Text>

        {isDevelopment && debugMessage ? (
          <Box
            as="pre"
            background="bg-surface-secondary"
            padding="300"
            borderRadius="200"
            overflowX="auto"
          >
            <Text as="code" variant="bodySm" tone="subdued" breakWord>
              {debugMessage}
            </Text>
          </Box>
        ) : null}

        {resetErrorBoundary ? (
          <Button variant="primary" onClick={resetErrorBoundary} size="slim">
            {t("common.retry", "Retry")}
          </Button>
        ) : null}
      </BlockStack>
    </Card>
  );
}
