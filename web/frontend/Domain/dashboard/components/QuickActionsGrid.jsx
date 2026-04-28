import { memo } from "react";
import {
  BlockStack,
  Box,
  Button,
  Card,
  Icon,
  InlineGrid,
  InlineStack,
  Text,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";

const QUICK_ACTION_COLUMNS = { xs: 1, sm: 2, md: 4, lg: 4, xl: 4 };

const QuickActionCard = memo(function QuickActionCard({
  icon,
  title,
  description,
  actionText,
  trustCopy,
  primary = false,
  disabled = false,
  disabledReason,
  loading = false,
  onAction,
}) {
  return (
    <Card roundedAbove="sm">
      <Box padding="400" height="100%">
        <BlockStack gap="300">
          <InlineStack gap="300" blockAlign="center" wrap={false}>
            <Box
              background="bg-surface-secondary"
              borderRadius="300"
              padding="300"
            >
              <Icon source={icon} tone="base" />
            </Box>
            <Text as="h3" variant="headingSm">
              {title}
            </Text>
          </InlineStack>

          <Text as="p" variant="bodySm" tone="subdued">
            {description}
          </Text>

          {disabled && disabledReason ? (
            <Text as="p" variant="bodySm" tone="critical">
              {disabledReason}
            </Text>
          ) : null}

          {trustCopy ? (
            <Text as="p" variant="bodySm" tone="subdued">
              {trustCopy}
            </Text>
          ) : null}

          <Button
            variant={primary ? "primary" : undefined}
            onClick={onAction}
            disabled={disabled}
            loading={loading}
          >
            {actionText}
          </Button>
        </BlockStack>
      </Box>
    </Card>
  );
});

function QuickActionsGrid({ actions }) {
  const { t } = useTranslation();

  return (
    <BlockStack gap="400">
      <BlockStack gap="100">
        <Text as="h2" variant="headingLg">
          {t("quickActions", "Quick actions")}
        </Text>
        <Text as="p" variant="bodyMd" tone="subdued">
          {t(
            "quickActionsDescription",
            "Run common catalog workflows without leaving the dashboard."
          )}
        </Text>
      </BlockStack>

      <InlineGrid columns={QUICK_ACTION_COLUMNS} gap="400">
        {actions.map((action) => (
          <QuickActionCard key={action.key} {...action} />
        ))}
      </InlineGrid>
    </BlockStack>
  );
}

export default memo(QuickActionsGrid);
