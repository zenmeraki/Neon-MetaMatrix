import React from "react";
import { Card, BlockStack, Text } from "@shopify/polaris";

export default function InfoCard() {
    return (
        <Card>
            <BlockStack gap="200">
                <Text variant="headingSm">
                    What happens next?
                </Text>
                <ul style={{ paddingLeft: 16 }}>
                    <li>Latest product data is fetched from Shopify</li>
                    <li>CSV is generated with selected columns</li>
                    <li>File downloads automatically</li>
                </ul>
            </BlockStack>
        </Card>
    );
}
