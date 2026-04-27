// web/frontend/Domain/dashboard/components/ThingsToDo.jsx
import React, { memo } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Button,
  SkeletonBodyText,
  Text,
} from "@shopify/polaris";

const ThingsToDo = memo(({ loading = false, actions = [], title }) => {
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          {title}
        </Text>

        {loading ? (
          <div role="status" aria-live="polite">
            <SkeletonBodyText lines={3} />
          </div>
        ) : (
          <BlockStack gap="300">
            {actions.map(({ id, label, helpText, primary, onClick }) => (
              <InlineStack key={id} gap="200" align="center" blockAlign="center">
                <Button
                  variant={primary ? "primary" : "secondary"}
                  onClick={onClick}
                  size="slim"
                >
                  {label}
                </Button>

                {helpText && (
                  <Text as="span" tone="subdued" variant="bodySm">
                    {helpText}
                  </Text>
                )}
              </InlineStack>
            ))}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
});

ThingsToDo.displayName = "ThingsToDo";
export default ThingsToDo;