import React, { useState } from "react";
import {
    Page,
    Card,
    Banner,
    Button,
    BlockStack,
    InlineStack,
    Loading,
    Text,
    List,
    Box,
    Divider,
    Badge,
} from "@shopify/polaris";

import CsvUploader from "../components/CsvUploader";
import CsvPreviewTable from "../components/CsvPreviewTable";
import ConfirmImportModal from "../components/ConfirmImportModal";
import { parseCSV } from "../utils/csvParser";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function Spreadsheet() {
    const { t } = useTranslation();
    const [file, setFile] = useState(null);
    const [parsedData, setParsedData] = useState([]);
    const [columnMappings, setColumnMappings] = useState({});
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [status, setStatus] = useState(null);
    const [uploading, setUploading] = useState(false);
    const navigate = useNavigate();

    const handleDrop = (_, acceptedFiles) => {
        const selectedFile = acceptedFiles[0];
        if (!selectedFile) return;

        setFile(selectedFile);
        setStatus(null);

        parseCSV(selectedFile, setParsedData, setColumnMappings, setStatus, t);
    };

    const handleUpload = async () => {
        try {
            if (!file) {
                throw new Error(t("spreadsheetNoFileSelected"));
            }

            setUploading(true);

            const formData = new FormData();
            formData.append("file", file);
            formData.append("columnMappings", JSON.stringify(columnMappings));

            const res = await fetch("/api/products/csv/import", {
                method: "POST",
                body: formData,
            });

            let result;
            try {
                result = await res.json();
            } catch {
                throw new Error(t("spreadsheetInvalidServerResponse"));

            }

            if (!res.ok) {
                throw new Error(
                    result?.message || t("spreadsheetUploadFailed")
                );

            }

            setStatus({
                type: "success",
                message:
                    result?.message ||
                    t("spreadsheetImportQueued"),
            });

            setFile(null);
            setParsedData([]);
            setColumnMappings({});
            console.log(result);
            navigate("/editDetails/" + result.importId);
            return true;
        } catch (err) {
            setStatus({
                type: "error",
                message:
                    err.message ||
                    t("spreadsheetSomethingWentWrong"),
            });
            return false;
        } finally {
            setUploading(false);
        }
    };

    return (
        <Page
            title={t("spreadsheetImportTitle")}
            subtitle={t("spreadsheetImportSubtitle")}
            fullWidth
        >
            {uploading && <Loading />}

            <BlockStack gap="500">
                {/* Intro / Guidance */}
                <Card roundedAbove="sm">
                    <Box
                        padding="700"
                        borderRadius="300"
                        overflowX="hidden"
                        overflowY="hidden"
                        style={{
                            background:
                                "linear-gradient(180deg, #ffffff 0%, #f8f8f8 55%, #f3f4f6 100%)",
                        }}
                    >
                        <BlockStack gap="400">
                            <BlockStack gap="200">
                                <InlineStack align="space-between" blockAlign="center">
                                    <Text as="h1" variant="headingLg">
                                        {t("spreadsheetImportNextTitle")}
                                    </Text>

                                    <Badge tone="info">
                                        {t("spreadsheetBadge")}
                                    </Badge>
                                </InlineStack>

                                <Box maxWidth="720px">
                                    <Text as="p" variant="bodyLg" tone="subdued">
                                        {t("spreadsheetIntroText")}
                                    </Text>
                                </Box>
                            </BlockStack>

                            <Box
                                padding="400"
                                borderRadius="300"
                                background="bg-surface"
                                borderWidth="025"
                                borderStyle="solid"
                                borderColor="border-secondary"
                            >
                                <BlockStack gap="250">
                                    <InlineStack align="space-between" blockAlign="center">
                                        <Text as="h5" variant="headingLg">
                                            {t("spreadsheetWarningTitle")}
                                        </Text>

                                        <Badge tone="attention">
                                            {t("spreadsheetReviewBadge")}
                                        </Badge>
                                    </InlineStack>

                                    <List type="bullet">
                                        <Box paddingBlockStart="300">
                                            <List.Item>
                                                {t("spreadsheetWarningFileType")}
                                            </List.Item>
                                            <List.Item>
                                                {t("spreadsheetWarningProductId")}
                                            </List.Item>
                                            <List.Item>
                                                {t("spreadsheetWarningVariantId")}
                                            </List.Item>
                                            <List.Item>
                                                {t("spreadsheetWarningEachRow")}
                                            </List.Item>
                                            <List.Item>
                                                {t("spreadsheetWarningIncorrectIds")}
                                            </List.Item>
                                        </Box>
                                    </List>
                                </BlockStack>
                            </Box>
                        </BlockStack>
                    </Box>
                </Card>

                {/* Uploading / status banners */}
                {uploading && (
                    <Banner tone="info">
                        {t("spreadsheetUploadingBanner")}
                    </Banner>
                )}

                {status && <Banner tone={status.type}>{status.message}</Banner>}

                {/* Upload area */}
                <Card roundedAbove="sm">
                    <Box padding="0">
                        <BlockStack gap="0">
                            <Box padding="500">
                                <BlockStack gap="150">
                                    <Text as="h3" variant="headingLg">
                                        {t("spreadsheetUploadSectionTitle")}
                                    </Text>
                                    <Text as="p" variant="bodyMd" tone="subdued">
                                        {t("spreadsheetUploadSectionText")}
                                    </Text>
                                </BlockStack>
                            </Box>

                            <Divider />

                            <Box padding="500">
                                <CsvUploader
                                    file={file}
                                    onDrop={handleDrop}
                                    onRemove={() => setFile(null)}
                                    disabled={uploading}
                                />
                            </Box>
                        </BlockStack>
                    </Box>
                </Card>

                {/* Preview area */}
                <Card roundedAbove="sm">
                    <Box padding="0">
                        <BlockStack gap="0">
                            <Box padding="500">
                                <BlockStack gap="150">
                                    <Text as="h3" variant="headingLg">
                                        {t("spreadsheetPreviewSectionTitle")}
                                    </Text>
                                    <Text as="p" variant="bodyMd" tone="subdued">
                                        {t("spreadsheetPreviewSectionText")}
                                    </Text>
                                </BlockStack>
                            </Box>

                            <Divider />

                            <Box padding="500">
                                <CsvPreviewTable
                                    parsedData={parsedData}
                                    columnMappings={columnMappings}
                                    onMappingChange={(csvCol, value) =>
                                        setColumnMappings((p) => ({
                                            ...p,
                                            [csvCol]: value,
                                        }))
                                    }
                                />
                            </Box>
                        </BlockStack>
                    </Box>
                </Card>

                {/* CTA */}
                <Card roundedAbove="sm">
                    <Box padding="500">
                        <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="050">
                                <Text as="h4" variant="headingLg">
                                    {t("spreadsheetReadyTitle")}
                                </Text>
                                <Box paddingBlockStart="150">
                                    <Text as="p" variant="bodySm" tone="subdued">
                                        {t("spreadsheetReadyText")}
                                    </Text>
                                </Box>

                            </BlockStack>

                            <Button
                                variant="primary"
                                onClick={() => setConfirmOpen(true)}
                                disabled={!file || uploading}
                                loading={uploading}
                            >
                                {t("spreadsheetImportButton")}
                            </Button>
                        </InlineStack>
                    </Box>
                </Card>
            </BlockStack>

            <ConfirmImportModal
                open={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={async () => {
                    const success = await handleUpload();
                    if (success) {
                        setConfirmOpen(false);
                    }
                }}
                loading={uploading}
            />
        </Page>
    );
}