import { DropZone, Icon, Text, Box, InlineStack, Button } from "@shopify/polaris";
import { UploadIcon, FileIcon } from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";

export default function CsvUploader({ file, onDrop, onRemove }) {
    const { t } = useTranslation();

    return (
        <DropZone allowMultiple={false} onDrop={onDrop} accept=".csv" type="file">

            {!file && (
                <Box padding="600">
                    <Text alignment="center">
                        <Icon source={UploadIcon} />
                        {t("spreadsheetDropzone", {
                            defaultValue: "Drag & drop CSV file or click to upload",
                        })}
                    </Text>
                </Box>
            )}

            {file && (
                <Box padding="400">
                    <InlineStack align="space-between">
                        <InlineStack gap="300">
                            <Icon source={FileIcon} />
                            <Text>{file.name}</Text>
                        </InlineStack>

                        <Button plain onClick={onRemove}>
                            {t("spreadsheetRemove", { defaultValue: "Remove" })}
                        </Button>
                    </InlineStack>
                </Box>
            )}

        </DropZone>
    );
}
