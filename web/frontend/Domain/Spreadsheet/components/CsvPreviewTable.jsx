import { Card, Text, Select, DataTable, BlockStack, InlineStack } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { getProductFields } from "../constants";

export default function CsvPreviewTable({
    parsedData,
    columnMappings,
    onMappingChange,
}) {
    const { t } = useTranslation();
    const productFields = getProductFields(t);

    if (!parsedData.length) return null;

    const headers = Object.keys(parsedData[0]);

    return (
        <Card>
            <BlockStack gap="300">
                <Text variant="headingSm">
                    {t("spreadsheetPreviewMapColumns", )}
                </Text>

                <DataTable
                    columnContentTypes={headers.map(() => "text")}
                    headings={headers.map((header, index) => {
                        // ✅ Force mapping
                        let forcedValue = columnMappings[header] || "";

                        if (index === 0) forcedValue = "id";
                        if (index === 1) forcedValue = "variant_id";

                        return (
                            <Select
                                label={header}
                                labelHidden
                                options={productFields}
                                value={forcedValue}
                                onChange={(value) => {
                                    // ❌ Prevent change for first 2 columns
                                    if (index === 0 || index === 1) return;

                                    onMappingChange(header, value);
                                }}
                                disabled={index === 0 || index === 1} // ✅ disable
                            />
                        );
                    })}
                    rows={parsedData
                        .slice(0, 50)
                        .map((row) => Object.values(row).map((v) => v || ""))}
                />

                <InlineStack align="space-between">
                    <Text tone="subdued">
                        {t("spreadsheetRowsLoaded", {
                            defaultValue: "{{count}} rows loaded",
                            count: parsedData.length,
                        })}
                    </Text>

                    <Text tone="subdued">
                        {t("spreadsheetColumnsMapped", {
                            defaultValue: "{{count}} columns mapped",
                            count: Object.values({
                                ...columnMappings,
                                [headers[0]]: "id",
                                [headers[1]]: "variant_id",
                            }).filter(Boolean).length,
                        })}
                    </Text>
                </InlineStack>
            </BlockStack>
        </Card>
    );
}
