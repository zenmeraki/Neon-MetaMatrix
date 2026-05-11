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
  const bodyText = description || trustCopy;

  return (
    <Card roundedAbove="sm">
      <Box padding="400" minHeight="240px">
        <BlockStack gap="300">
          <InlineStack gap="300" blockAlign="center" wrap={false}>
            <Box
              background="bg-surface-secondary"
              borderRadius="300"
              padding="200"
            >
              <Icon source={icon} tone="base" />
            </Box>
            <Text as="h3" variant="headingSm">
              {title}
            </Text>
          </InlineStack>

          {bodyText ? (
            <Text as="p" variant="bodySm">
              {bodyText}
            </Text>
          ) : (
            <Box minHeight="40px" />
          )}

          {disabled && disabledReason ? (
            <Text as="p" variant="bodySm" tone="critical">
              {disabledReason}
            </Text>
          ) : (
            <Box minHeight="20px" />
          )}

          <Button
            fullWidth
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
    <BlockStack gap="300">
      <BlockStack gap="050">
        <Text as="h2" variant="headingLg">
          {t("quickActions", "Quick actions")}
        </Text>
        <Text as="p" variant="bodyMd">
          {t(
            "quickActionsDescription",
            "Run common catalog workflows without leaving the dashboard."
          )}
        </Text>
      </BlockStack>

      <InlineGrid columns={QUICK_ACTION_COLUMNS} gap="400" alignItems="stretch">
        {actions.map((action) => (
          <QuickActionCard key={action.key} {...action} />
        ))}
      </InlineGrid>
    </BlockStack>
  );
}

export default memo(QuickActionsGrid);