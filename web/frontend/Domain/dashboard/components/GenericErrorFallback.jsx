// web/frontend/components/GenericErrorFallback.jsx
import React from "react";
import { Card, Button, Text } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { redirectToAuthWithReturnTo } from "../../../hooks/useAuthenticatedFetch";

function isSessionRecoveryError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("session expired") ||
    message.includes("shopify session missing") ||
    message.includes("unauthorized")
  );
}

export default function GenericErrorFallback({ error, resetErrorBoundary }) {
  const { t } = useTranslation();
  const canReconnect = isSessionRecoveryError(error);
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
        {canReconnect ? (
          <Button onClick={() => redirectToAuthWithReturnTo()} size="slim">
            {t("common.reconnectShopify", "Reconnect Shopify")}
          </Button>
        ) : (
          <Button onClick={resetErrorBoundary} size="slim">
            {t("common.retry", "Retry")}
          </Button>
        )}
      </div>
    </Card>
  );
}
