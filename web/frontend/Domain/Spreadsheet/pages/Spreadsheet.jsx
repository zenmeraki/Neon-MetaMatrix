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

export default function Spreadsheet() {
    const [file, setFile] = useState(null);
    const [parsedData, setParsedData] = useState([]);
    const [columnMappings, setColumnMappings] = useState({});
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [status, setStatus] = useState(null);
    const [uploading, setUploading] = useState(false);

    const handleDrop = (_, acceptedFiles) => {
        const selectedFile = acceptedFiles[0];
        if (!selectedFile) return;

        setFile(selectedFile);
        setStatus(null);

        parseCSV(selectedFile, setParsedData, setColumnMappings, setStatus);
    };

    const handleUpload = async () => {
        try {
            if (!file) {
                throw new Error("No file selected");
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
                throw new Error("Invalid server response");
            }

            if (!res.ok) {
                throw new Error(result?.message || "Upload failed");
            }

            setStatus({
                type: "success",
                message: result?.message || "Import queued successfully",
            });

            setFile(null);
            setParsedData([]);
            setColumnMappings({});

            return true;
        } catch (err) {
            setStatus({
                type: "error",
                message: err.message || "Something went wrong",
            });
            return false;
        } finally {
            setUploading(false);
        }
    };

    return (
        <Page title="Import Products" fullWidth>

            <BlockStack gap="500">

                {/* ✅ Warning + Download */}
                <Card>
                    <BlockStack gap="300">

                        <Banner tone="warning">
                            <BlockStack gap="200">
                                <Text as="p" fontWeight="semibold">
                                    Important before importing CSV
                                </Text>

                                <List type="bullet">
                                    <List.Item>
                                        The uploaded file must be a <b>.csv file</b>.
                                    </List.Item>
                                    <List.Item>
                                        The first column should contain the <b>Product ID</b>.
                                    </List.Item>
                                    <List.Item>
                                        The second column should contain the <b>Variant ID</b>.
                                    </List.Item>
                                    <List.Item>
                                        Each row must contain the correct <b>Product ID</b> and <b>Variant ID</b>.
                                    </List.Item>
                                    <List.Item>
                                        Incorrect IDs may update the <b>wrong products</b>.
                                    </List.Item>
                                </List>
                            </BlockStack>
                        </Banner>

                    </BlockStack>
                </Card>

                {uploading && <Loading />}

                {uploading && (
                    <Banner tone="info">
                        Importing products... Please wait.
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
                        Import Products
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