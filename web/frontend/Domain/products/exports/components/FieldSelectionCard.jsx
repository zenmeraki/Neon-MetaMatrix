import React from "react";
import {
    Card,
    BlockStack,
    InlineStack,
    Checkbox,
    Divider,
    Text,
    Badge,
} from "@shopify/polaris";

export default function FieldSelectionCard({
    productFields,
    variantFields,
    seoFields,
    selectedFields,
    setSelectedFields,
    allFields,
    loading,
}) {
    const toggleField = (value) => {
        setSelectedFields((prev) =>
            prev.includes(value)
                ? prev.filter((f) => f !== value)
                : [...prev, value]
        );
    };

    const handleSelectAll = () => {
        if (selectedFields.length === allFields.length) {
            setSelectedFields([]);
        } else {
            setSelectedFields(allFields.map((f) => f.value));
        }
    };

    const renderSection = (title, fields) => (
        <BlockStack gap="200">
            <InlineStack align="space-between">
                <Text variant="headingXs" tone="subdued">
                    {title}
                </Text>
                <Badge>{fields.length} fields</Badge>
            </InlineStack>

            <InlineStack wrap gap="400">
                {fields.map((field) => (
                    <div key={field.value} style={{ minWidth: 250 }}>
                        <Checkbox
                            label={field.label}
                            checked={selectedFields.includes(field.value)}
                            onChange={() => toggleField(field.value)}
                            disabled={loading}
                        />
                    </div>
                ))}
            </InlineStack>
        </BlockStack>
    );

    return (
        <Card>
            <BlockStack gap="400">
                <InlineStack align="space-between">
                    <Text variant="headingSm">
                        Select Fields to Export
                    </Text>

                    <Checkbox
                        label={
                            selectedFields.length === allFields.length
                                ? "Deselect All"
                                : "Select All"
                        }
                        checked={selectedFields.length === allFields.length}
                        onChange={handleSelectAll}
                        disabled={loading}
                    />
                </InlineStack>

                <Divider />

                {renderSection("🧾 Product Fields", productFields)}
                <Divider />
                {renderSection("📦 Variant Fields", variantFields)}
                <Divider />
                {renderSection("🔍 SEO Fields", seoFields)}
            </BlockStack>
        </Card>
    );
}
