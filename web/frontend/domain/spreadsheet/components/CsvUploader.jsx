import { DropZone, Icon, Text, Box, InlineStack, Button } from "@shopify/polaris";
import { UploadIcon, FileIcon } from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";

export default function CsvUploader({ file, onDrop, onRemove, disabled = false }) {
    const { t } = useTranslation();

    return (
        <DropZone
            allowMultiple={false}
            onDrop={onDrop}
            accept=".csv,.xlsx,.xls,text/csv,application/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain"
            type="file"
            disabled={disabled}
        >

            {!file && (
                <Box padding="600">
                    <Text as="p" alignment="center">
                        <Icon source={UploadIcon} />
                        {t("spreadsheetDropzone",)}
                    </Text>
                </Box>
            )}

            {file && (
                <Box padding="400">
                    <InlineStack align="space-between">
                        <InlineStack gap="300">
                            <Icon source={FileIcon} />
                            <Text as="p">{file.name}</Text>
                        </InlineStack>

                        <Button variant="plain" onClick={onRemove} disabled={disabled}>
                            {t("spreadsheetRemove", { defaultValue: "Remove" })}
                        </Button>
                    </InlineStack>
                </Box>
            )}

        </DropZone>
    );
}
