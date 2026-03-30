import React from "react";
import {
  Card,
  InlineStack as InlineStack,
  Icon,
  Text,
  Button,
} from "@shopify/polaris";

function StatCard({ icon, label, value, url }) {
  return (
    <Card>
      <Card.Section>
        <InlineStack alignment="center" spacing="tight">
          <Icon source={icon} />
          <Text variation="strong">
            {label} {value != null && `— ${value}`}
          </Text>
        </InlineStack>
      </Card.Section>
      {url && (
        <Card.Section>
          <Button fullWidth plain url={url}>
            {label}
          </Button>
        </Card.Section>
      )}
    </Card>
  );
}

export default StatCard;