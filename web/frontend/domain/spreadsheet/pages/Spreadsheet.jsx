import React, { useRef, useState } from "react";
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
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthenticatedFetch } from "../../../hooks/useAuthenticatedFetch";

export default function Spreadsheet() {
    const { t } = useTranslation();
    const fetchWithAuth = useAuthenticatedFetch();
    const [file, setFile] = useState(null);
    const [parsedData, setParsedData] = useState([]);
    const [columnMappings, setColumnMappings] = useState({});
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [status, setStatus] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [uploadSession, setUploadSession] = useState({
        uploadSessionId: "",
        fileHash: "",
    });
    const [previewSummary, setPreviewSummary] = useState(null);
    const uploadInFlightRef = useRef(false);
    const navigate = useNavigate();
    const MAX_FILE_BYTES = 50 * 1024 * 1024;
    const MULTIPART_CHUNK_BYTES = 8 * 1024 * 1024;
    const ALLOWED_SPREADSHEET_MIME_TYPES = new Set([
        "text/csv",
        "application/csv",
        "application/vnd.ms-excel",
        "text/plain",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "",
    ]);

    const parseJsonOrThrow = async (response) => {
        let result = null;
        try {
            result = await response.json();
        } catch {
            throw new Error(t("spreadsheetInvalidServerResponse"));
        }
        if (!response.ok) {
            throw new Error(result?.message || t("spreadsheetUploadFailed"));
        }
        return result;
    };

    const handleDrop = (_, acceptedFiles) => {
        void (async () => {
        const selectedFile = acceptedFiles[0];
        if (!selectedFile) return;
        if (selectedFile.size > MAX_FILE_BYTES) {
            setStatus({
                type: "error",
                message: t("spreadsheetFileTooLarge", {
                    defaultValue: "File is too large. Maximum allowed size is 50MB.",
                }),
            });
            return;
        }
        const lowerFileName = String(selectedFile.name || "").toLowerCase();
        const isSupportedFile =
            lowerFileName.endsWith(".csv") ||
            lowerFileName.endsWith(".xlsx") ||
            lowerFileName.endsWith(".xls");
        if (!isSupportedFile) {
            setStatus({
                type: "error",
                message: t("spreadsheetInvalidFileType", {
                    defaultValue: "Only CSV/XLSX/XLS files are allowed.",
                }),
            });
            return;
        }
        const mimeType = String(selectedFile.type || "").toLowerCase();
        if (!ALLOWED_SPREADSHEET_MIME_TYPES.has(mimeType)) {
            setStatus({
                type: "error",
                message: t("spreadsheetInvalidMimeType", {
                    defaultValue: "Invalid file type. Please upload a valid spreadsheet file.",
                }),
            });
            return;
        }

        setFile(selectedFile);
        setStatus(null);
        const uploadSessionId =
            (typeof crypto !== "undefined" && crypto.randomUUID)
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const fileBuffer = await selectedFile.arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", fileBuffer);
        const hashHex = Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
        setUploadSession({
            uploadSessionId,
            fileHash: hashHex,
        });
        setPreviewSummary(null);
        setParsedData([]);
        setColumnMappings({});
        setStatus({
            type: "info",
            message: t("spreadsheetFileReadyForServerValidation", {
                defaultValue: "File selected. Preview and mapping will load after staged validation.",
            }),
        });
        })().catch((error) => {
            setStatus({
                type: "error",
                message: error?.message || t("spreadsheetSomethingWentWrong"),
            });
        });
    };

    const handleRemoveFile = () => {
        setFile(null);
        setParsedData([]);
        setColumnMappings({});
        setStatus(null);
        setUploadSession({
            uploadSessionId: "",
            fileHash: "",
        });
        setPreviewSummary(null);
    };

    const hasRequiredMappings = true;

    const handleUpload = async () => {
        let stagedKey = "";
        let stagedUploadId = "";
        try {
            if (uploadInFlightRef.current) {
                return false;
            }
            if (!file) {
                throw new Error(t("spreadsheetNoFileSelected"));
            }

            uploadInFlightRef.current = true;
            setUploading(true);

            const initRes = await fetchWithAuth("/api/products/csv/import/staged/init", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
                body: JSON.stringify({
                    fileName: file.name,
                    contentType: file.type || "text/csv",
                    fileSizeBytes: Number(file.size || 0),
                }),
            });
            const initResult = await parseJsonOrThrow(initRes);
            stagedKey = initResult?.data?.key || "";
            stagedUploadId = initResult?.data?.uploadId || "";

            if (!stagedKey || !stagedUploadId) {
                throw new Error(t("spreadsheetUploadFailed"));
            }

            const totalParts = Math.ceil(file.size / MULTIPART_CHUNK_BYTES);
            const completedParts = [];
            for (let partIndex = 0; partIndex < totalParts; partIndex += 1) {
                const partNumber = partIndex + 1;
                const start = partIndex * MULTIPART_CHUNK_BYTES;
                const end = Math.min(start + MULTIPART_CHUNK_BYTES, file.size);
                const chunk = file.slice(start, end);

                const partUrl =
                    `/api/products/csv/import/staged/part/${partNumber}` +
                    `?key=${encodeURIComponent(stagedKey)}` +
                    `&uploadId=${encodeURIComponent(stagedUploadId)}`;

                const partRes = await fetchWithAuth(partUrl, {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/octet-stream",
                    },
                    body: chunk,
                });
                const partResult = await parseJsonOrThrow(partRes);
                completedParts.push({
                    partNumber,
                    eTag: partResult?.data?.eTag,
                });
            }

            const completeRes = await fetchWithAuth("/api/products/csv/import/staged/complete", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
                body: JSON.stringify({
                    key: stagedKey,
                    uploadId: stagedUploadId,
                    parts: completedParts,
                }),
            });
            await parseJsonOrThrow(completeRes);

            const validateRes = await fetchWithAuth("/api/products/csv/import/staged/validate", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
                body: JSON.stringify({
                    key: stagedKey,
                    columnMappings,
                }),
            });
            const validateResult = await parseJsonOrThrow(validateRes);
            const summary = validateResult?.data || null;
            setPreviewSummary(summary);
            if (Array.isArray(summary?.previewRows)) {
                setParsedData(summary.previewRows);
            }
            if (summary?.effectiveMappings && typeof summary.effectiveMappings === "object") {
                setColumnMappings(summary.effectiveMappings);
            } else if (summary?.inferredMappings && typeof summary.inferredMappings === "object") {
                setColumnMappings(summary.inferredMappings);
            }
            if (!summary?.canQueue) {
                setStatus({
                    type: "error",
                    message:
                        t("spreadsheetValidationFailed", {
                            defaultValue: "Import validation failed. Fix CSV rows and try again.",
                        }),
                });
                return false;
            }

            const queueRes = await fetchWithAuth("/api/products/csv/import/staged/queue", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
                body: JSON.stringify({
                    key: stagedKey,
                    fileName: file.name,
                    columnMappings,
                    uploadSessionId: uploadSession.uploadSessionId || "",
                    fileHash: uploadSession.fileHash || "",
                }),
            });
            const result = await parseJsonOrThrow(queueRes);

            setStatus({
                type: "success",
                message:
                    result?.message ||
                    t("spreadsheetImportQueued"),
            });

            setFile(null);
            setParsedData([]);
            setColumnMappings({});
            setPreviewSummary(null);
            navigate("/editDetails/" + result.importId);
            return true;
        } catch (err) {
            if (stagedKey && stagedUploadId) {
                try {
                    await fetchWithAuth("/api/products/csv/import/staged/abort", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Accept: "application/json",
                        },
                        body: JSON.stringify({
                            key: stagedKey,
                            uploadId: stagedUploadId,
                        }),
                    });
                } catch (_abortError) {}
            }
            setStatus({
                type: "error",
                message:
                    err.message ||
                    t("spreadsheetSomethingWentWrong"),
            });
            return false;
        } finally {
            setUploading(false);
            uploadInFlightRef.current = false;
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
                                    onRemove={handleRemoveFile}
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
                                    totalRows={previewSummary?.totalRows ?? (parsedData.length || 0)}
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
                                disabled={!file || uploading || !hasRequiredMappings}
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
                summary={previewSummary || {
                    validRows: parsedData.length,
                    invalidRows: 0,
                    fieldsChanged: Object.values(columnMappings || {}).filter(Boolean),
                    undoAvailable: true,
                }}
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
