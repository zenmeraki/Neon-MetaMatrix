import { memo, useCallback } from "react";
import {
  Card,
  InlineStack,
  Icon,
  Text,
  Button,
  BlockStack,
} from "@shopify/polaris";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

function StatCard({ icon, label, value, url, external = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleNavigate = useCallback(() => {
    if (!url || external) return;
    navigate(url);
  }, [external, navigate, url]);

  return (
    <Card padding="400">
      <BlockStack gap="200">
        <InlineStack align="start" gap="200" blockAlign="center">
          <Icon source={icon} tone="base" />

          <BlockStack gap="050">
            <Text variant="headingSm" as="p">
              {label}
            </Text>

            {value != null ? (
              <Text variant="headingMd" as="p">
                {value}
              </Text>
            ) : null}
          </BlockStack>
        </InlineStack>

        {url ? (
          external ? (
            <Button variant="plain" fullWidth url={url} external>
              {t("statCard.viewDetails", "View details")}
            </Button>
          ) : (
            <Button variant="plain" fullWidth onClick={handleNavigate}>
              {t("statCard.viewDetails", "View details")}
            </Button>
          )
        ) : null}
      </BlockStack>
    </Card>
  );
}

export default memo(StatCard);
