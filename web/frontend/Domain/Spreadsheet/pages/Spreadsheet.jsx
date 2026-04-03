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
} from "@shopify/polaris";

import CsvUploader from "../components/CsvUploader";
import CsvPreviewTable from "../components/CsvPreviewTable";
import ConfirmImportModal from "../components/ConfirmImportModal";
import { parseCSV } from "../utils/csvParser";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authenticatedFetch } from "../../../hooks/useAuthenticatedFetch";

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
                throw new Error(t("spreadsheetNoFileSelected", { defaultValue: "No file selected" }));
            }

            setUploading(true);

            const formData = new FormData();
            formData.append("file", file);
            formData.append("columnMappings", JSON.stringify(columnMappings));

            const res = await authenticatedFetch("/api/products/csv/import", {
                method: "POST",
                body: formData,
            });

            let result;
            try {
                result = await res.json();
            } catch {
                throw new Error(t("spreadsheetInvalidServerResponse", { defaultValue: "Invalid server response" }));
            }

            if (!res.ok) {
                throw new Error(result?.message || t("spreadsheetUploadFailed", { defaultValue: "Upload failed" }));
            }

            setStatus({
                type: "success",
                message: result?.message || t("spreadsheetImportQueued", { defaultValue: "Import queued successfully" }),
            });

            setFile(null);
            setParsedData([]);
            setColumnMappings({});
            console.log(result)
            navigate("/editDetails/" + result.importId);
            return true;
        } catch (err) {
            setStatus({
                type: "error",
                message: err.message || t("spreadsheetSomethingWentWrong", { defaultValue: "Something went wrong" }),
            });
            return false;
        } finally {
            setUploading(false);
        }
    };

    return (
        <Page title={t("spreadsheetImportTitle", { defaultValue: "Import Products" })} fullWidth>

            <BlockStack gap="500">

                {/* ✅ Warning + Download */}
                <Card>
                    <BlockStack gap="300">

                        <Banner tone="warning">
                            <BlockStack gap="200">
                                <Text as="p" fontWeight="semibold">
                                    {t("spreadsheetWarningTitle", { defaultValue: "Important before importing CSV" })}
                                </Text>

                                <List type="bullet">
                                    <List.Item>
                                        {t("spreadsheetWarningFileType", {
                                            defaultValue: "The uploaded file must be a .csv file.",
                                        })}
                                    </List.Item>
                                    <List.Item>
                                        {t("spreadsheetWarningProductId", {
                                            defaultValue: "The first column should contain the Product ID.",
                                        })}
                                    </List.Item>
                                    <List.Item>
                                        {t("spreadsheetWarningVariantId", {
                                            defaultValue: "The second column should contain the Variant ID.",
                                        })}
                                    </List.Item>
                                    <List.Item>
                                        {t("spreadsheetWarningEachRow", {
                                            defaultValue: "Each row must contain the correct Product ID and Variant ID.",
                                        })}
                                    </List.Item>
                                    <List.Item>
                                        {t("spreadsheetWarningIncorrectIds", {
                                            defaultValue: "Incorrect IDs may update the wrong products.",
                                        })}
                                    </List.Item>
                                </List>
                            </BlockStack>
                        </Banner>

                    </BlockStack>
                </Card>

                {uploading && <Loading />}

                {uploading && (
                    <Banner tone="info">
                        {t("spreadsheetUploadingBanner", {
                            defaultValue: "Importing products... Please wait.",
                        })}
                    </Banner>
                )}

                {status && (
                    <Banner tone={status.type}>
                        {status.message}
                    </Banner>
                )}

                <Card>
                    <CsvUploader
                        file={file}
                        onDrop={handleDrop}
                        onRemove={() => setFile(null)}
                        disabled={uploading}
                    />
                </Card>

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

                <InlineStack>
                    <Button
                        variant="primary"
                        onClick={() => setConfirmOpen(true)}
                        disabled={!file || uploading}
                        loading={uploading}
                    >
                        {t("spreadsheetImportButton", { defaultValue: "Import Products" })}
                    </Button>
                </InlineStack>

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
