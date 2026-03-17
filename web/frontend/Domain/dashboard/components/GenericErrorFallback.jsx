// web/frontend/components/GenericErrorFallback.jsx
import React from "react";
import { Card, Button, Text } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

export default function GenericErrorFallback({ error, resetErrorBoundary }) {
  const { t } = useTranslation();
  return (
    <Card sectioned>
      <Text as="p" variant="bodyMd">
        {t("common.somethingWentWrong", "Something went wrong.")}{" "}
        {process.env.NODE_ENV === "development" && error?.message && (
          <Text as="span" color="subdued">
            ({error.message})
          </Text>
        )}
      </Text>
      <div style={{ marginTop: 8 }}>
        <Button onClick={resetErrorBoundary} size="slim">
          {t("common.retry", "Retry")}
        </Button>
      </div>
    </Card>
  );
}