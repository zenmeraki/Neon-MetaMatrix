import { memo } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Button,
  SkeletonBodyText,
  Text,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";

const ThingsToDo = memo(function ThingsToDo({
  loading = false,
  actions = [],
  title,
}) {
  const { t } = useTranslation();

  return (
    <Card padding="400">
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          {title ?? ""}
        </Text>

        <Text as="span" visuallyHidden aria-live="polite">
          {loading ? t("common.loading", "Loading") : ""}
        </Text>

        {loading ? (
          <SkeletonBodyText lines={3} />
        ) : (
          <BlockStack gap="300">
            {actions.map(({ id, label, helpText, primary, onClick }) => {
              if (import.meta.env.DEV && !id) {
                console.warn(`ThingsToDo: action "${label}" is missing an id`);
              }

              return (
                <InlineStack
                  key={id ?? label}
                  gap="200"
                  align="start"
                  blockAlign="center"
                >
                  <Button
                    variant={primary ? "primary" : undefined}
                    onClick={onClick}
                    size="slim"
                  >
                    {label}
                  </Button>

                  {helpText ? (
                    <Text as="span" tone="subdued" variant="bodySm">
                      {helpText}
                    </Text>
                  ) : null}
                </InlineStack>
              );
            })}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
});

export default ThingsToDo;
