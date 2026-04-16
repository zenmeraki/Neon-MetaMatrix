import React, { useState, useCallback, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  DataTable,
  Banner,
  InlineStack,
  ProgressBar,
  Box,
  BlockStack,
  Thumbnail,
  EmptyState,
  Icon,
  Spinner,
  Button,
} from "@shopify/polaris";
import {
  ClockIcon,
  PlayIcon,
  CheckIcon,
  XIcon,
  RefreshIcon,
} from "@shopify/polaris-icons";
import Papa from "papaparse";
import { useTranslation } from "react-i18next";
import { productFallbackImage } from "../../../../assets";

function formatDuration(ms = 0) {
  if (!ms || ms < 0) return "0s";

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function getPrimaryStatus(historyItem) {
  if (historyItem?.primaryStatus) {
    return historyItem.primaryStatus;
  }

  const status = String(historyItem?.status || "").toLowerCase();
  if (status === "completed") {
    return { key: "completed", label: "Completed", tone: "success", isTerminal: true };
  }
  if (status === "failed") {
    return { key: "failed", label: "Failed", tone: "critical", isTerminal: true };
  }
  if (status === "processing") {
    return { key: "processing", label: "Processing", tone: "info", isTerminal: false };
  }

  return { key: "pending", label: "Pending", tone: "attention", isTerminal: false };
}

function getUndoStatus(historyItem) {
  if (historyItem?.undoStatusSummary) {
    return historyItem.undoStatusSummary;
  }

  const undoStatus = String(historyItem?.undo?.status || "").toLowerCase();
  if (!undoStatus || undoStatus === "idle") return null;

  if (undoStatus === "completed") {
    return { key: "undo_completed", label: "Undo completed", tone: "success", isTerminal: true };
  }

  if (undoStatus === "failed") {
    return { key: "undo_failed", label: "Undo failed", tone: "critical", isTerminal: true };
  }

  return { key: "undo_processing", label: "Undo processing", tone: "info", isTerminal: false };
}

function getStatusIcon(statusKey) {
  switch (statusKey) {
    case "completed":
    case "undo_completed":
      return CheckIcon;
    case "failed":
    case "undo_failed":
    case "cancelled":
    case "undo_cancelled":
      return XIcon;
    case "dispatching":
    case "awaiting_shopify":
    case "finalizing":
    case "running":
    case "processing":
    case "undo_dispatching":
    case "undo_awaiting_shopify":
    case "undo_finalizing":
    case "undo_processing":
      return PlayIcon;
    case "queued":
    case "pending":
    case "undo_queued":
      return ClockIcon;
    default:
      return RefreshIcon;
  }
}

function isActiveStatus(statusSummary) {
  return Boolean(statusSummary) && statusSummary.isTerminal !== true;
}

function normalizeErrors(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return [value];
  return [{ message: String(value) }];
}

export default function EditDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [historyItem, setHistoryItem] = useState(null);
  const [changes, setChanges] = useState([]);
  const [changeField, setChangeField] = useState("");
  const [isVariantChange, setIsVariantChange] = useState(false);

  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isLoadingChanges, setIsLoadingChanges] = useState(true);

  const [error, setError] = useState(null);
  const [changesError, setChangesError] = useState(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalChanges, setTotalChanges] = useState(0);

  const itemsPerPage = 10;

  const handleBack = useCallback(() => {
    navigate("/history");
  }, [navigate]);

  const fetchHistoryDetails = useCallback(async () => {
    if (!id) {
      setError("No history ID provided");
      setIsLoadingHistory(false);
      return;
    }

    try {
      setIsLoadingHistory(true);
      setError(null);

      const response = await fetch(`/api/history/get-edit-history-details/${id}`);
      if (!response.ok) {
        throw new Error("Failed to fetch history");
      }

      const json = await response.json();
      setHistoryItem(json?.data || null);
    } catch (err) {
      setError(err?.message || "Failed to fetch history");
    } finally {
      setIsLoadingHistory(false);
    }
  }, [id]);

  const fetchChanges = useCallback(
    async (page = 1) => {
      if (!id) return;

      try {
        setChangesError(null);
        setIsLoadingChanges(true);

        const response = await fetch(
          `/api/history/get-edit-history/changes/${id}?page=${page}&limit=${itemsPerPage}`,
        );

        if (!response.ok) {
          throw new Error("Failed to fetch changes");
        }

        const json = await response.json();
        const changeRows = Array.isArray(json?.data) ? json.data : [];
        const meta = json?.meta || {};

        setChanges(changeRows);
        setTotalPages(Number(meta?.totalPages) || 1);
        setTotalChanges(Number(meta?.totalCount) || changeRows.length || 0);
        setCurrentPage(Number(meta?.currentPage) || page);

        const hasVariantChanges = changeRows.some(
          (item) =>
            Array.isArray(item?.variantFieldChanges) &&
            item.variantFieldChanges.length > 0,
        );

        setIsVariantChange(hasVariantChanges);

        const firstField =
          changeRows
            .flatMap((item) => [
              ...(Array.isArray(item?.productFieldChanges)
                ? item.productFieldChanges.map((c) => c?.field)
                : []),
              ...(Array.isArray(item?.variantFieldChanges)
                ? item.variantFieldChanges.flatMap((variant) =>
                    Array.isArray(variant?.changes)
                      ? variant.changes.map((c) => c?.field)
                      : [],
                  )
                : []),
            ])
            .find(Boolean) || "";

        setChangeField(firstField);
      } catch (err) {
        setChanges([]);
        setChangeField("");
        setIsVariantChange(false);
        setTotalPages(1);
        setTotalChanges(0);
        setCurrentPage(page);
        setChangesError(err?.message || "Failed to fetch changes");
      } finally {
        setIsLoadingChanges(false);
      }
    },
    [id],
  );

  useEffect(() => {
    fetchHistoryDetails();
  }, [fetchHistoryDetails]);

  useEffect(() => {
    fetchChanges(1);
  }, [fetchChanges]);

  useEffect(() => {
    if (!historyItem?.id) return;

    const primaryStatus = getPrimaryStatus(historyItem);
    const undoStatus = getUndoStatus(historyItem);

    if (!isActiveStatus(primaryStatus) && !isActiveStatus(undoStatus)) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/history/get-edit-history-details/${id}`);
        if (!res.ok) return;

        const json = await res.json();
        const updated = json?.data;
        if (!updated) return;

        setHistoryItem(updated);

        const nextPrimaryStatus = getPrimaryStatus(updated);
        const nextUndoStatus = getUndoStatus(updated);

        if (
          nextPrimaryStatus.key === "completed" ||
          nextUndoStatus?.key === "undo_completed"
        ) {
          fetchChanges(currentPage);
        }

        if (!isActiveStatus(nextPrimaryStatus) && !isActiveStatus(nextUndoStatus)) {
          clearInterval(interval);
        }
      } catch (pollErr) {
        console.warn("Polling error:", pollErr);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [historyItem, id, currentPage, fetchChanges]);

  const flattenedRows = useMemo(() => {
    if (!Array.isArray(changes) || changes.length === 0) return [];

    return changes.flatMap((change) => {
      const productTitle = change?.title || "Untitled product";
      const productImage = change?.image || "";

      const productRows = Array.isArray(change?.productFieldChanges)
        ? change.productFieldChanges.map((fieldChange) => ({
            image: productImage,
            title: productTitle,
            scope: t("scope.product"),
            field: fieldChange?.field || changeField || "N/A",
            oldValue:
              fieldChange?.oldValue !== undefined && fieldChange?.oldValue !== null
                ? String(fieldChange.oldValue)
                : "N/A",
            newValue:
              fieldChange?.newValue !== undefined && fieldChange?.newValue !== null
                ? String(fieldChange.newValue)
                : "N/A",
          }))
        : [];

      const variantRows = Array.isArray(change?.variantFieldChanges)
        ? change.variantFieldChanges.flatMap((variantChange) => {
            if (!Array.isArray(variantChange?.changes)) return [];

            return variantChange.changes.map((fieldChange) => ({
              image: productImage,
              title: `${productTitle} - ${variantChange?.variantTitle || "Default Title"}`,
              scope: t("scope.variant"),
              field: fieldChange?.field || changeField || "N/A",
              oldValue:
                fieldChange?.oldValue !== undefined && fieldChange?.oldValue !== null
                  ? String(fieldChange.oldValue)
                  : "N/A",
              newValue:
                fieldChange?.newValue !== undefined && fieldChange?.newValue !== null
                  ? String(fieldChange.newValue)
                  : "N/A",
            }));
          })
        : [];

      return [...productRows, ...variantRows];
    });
  }, [changes, changeField, t]);

  const tableRows = useMemo(
    () =>
      flattenedRows.map((item, index) => [
        <InlineStack key={`product-cell-${index}`} gap="300" wrap={false}>
          <Thumbnail
            source={item.image || productFallbackImage}
            alt=""
            size="small"
          />
          <BlockStack inlineAlign="start">
            <div style={{ maxWidth: "220px" }}>
              <Text truncate fontWeight="semibold">
                {item.title}
              </Text>
            </div>
            <Text tone="subdued" variant="bodySm">
              {item.scope}
            </Text>
          </BlockStack>
        </InlineStack>,
        <Text key={`field-${index}`} fontWeight="semibold">
          {item.field}
        </Text>,
        <BlockStack key={`change-${index}`}>
          <Text variant="bodyMd" tone="subdued" as="span">
            <s>{item.oldValue}</s>
          </Text>
          <Text>{item.newValue}</Text>
        </BlockStack>,
      ]),
    [flattenedRows],
  );

  const handleDownloadLogs = useCallback(() => {
    if (!historyItem?.id || flattenedRows.length === 0) return;

    const csvData = flattenedRows.map((row) => ({
      ProductTitle: row.title,
      Scope: row.scope,
      Field: row.field,
      OldValue: row.oldValue,
      NewValue: row.newValue,
      EditID: historyItem.id,
      Shop: historyItem.shop || "",
      Status: historyItem.primaryStatus?.label || historyItem.status || "",
    }));

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `edit-history-${historyItem.id}-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }, [flattenedRows, historyItem]);

  if (isLoadingHistory) {
    return (
      <Page
        fullWidth
        title="Loading Details..."
        backAction={{ content: "History", onAction: handleBack }}
      >
        <Layout>
          <Layout.Section>
            <Card>
              <Box padding="500">
                <InlineStack align="center" gap="300">
                  <Spinner size="large" />
                  <Text tone="subdued">Loading history details...</Text>
                </InlineStack>
              </Box>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  if (error) {
    return (
      <Page
        fullWidth
        title="Error"
        backAction={{ content: "History", onAction: handleBack }}
      >
        <Banner tone="critical">{error}</Banner>
      </Page>
    );
  }

  if (!historyItem) return null;

  const title = historyItem?.title || t("EditDetails");
  const primaryStatus = getPrimaryStatus(historyItem);
  const undoStatus = getUndoStatus(historyItem);
  const statusBadge = { tone: primaryStatus.tone, children: primaryStatus.label };
  const undoBadge = undoStatus
    ? { tone: undoStatus.tone, children: undoStatus.label }
    : null;
  const mainProgress = historyItem?.progressSummary || {
    current: Number(historyItem?.progressCount || historyItem?.processedCount || 0),
    total: Number(historyItem?.targetSnapshotCount || historyItem?.totalItems || 0),
    percent:
      Number(historyItem?.targetSnapshotCount || historyItem?.totalItems || 0) > 0
        ? Math.round(
            (Number(historyItem?.progressCount || historyItem?.processedCount || 0) /
              Number(historyItem?.targetSnapshotCount || historyItem?.totalItems || 1)) *
              100,
          )
        : primaryStatus.key === "completed"
          ? 100
          : 0,
    label: "",
  };
  const undoProcessed = Number(historyItem?.undo?.processedCount || 0);
  const undoTotal = Number(historyItem?.targetSnapshotCount || historyItem?.totalItems || 0);
  const undoErrors = normalizeErrors(
    historyItem?.supportStatus?.undoErrors || historyItem?.undo?.error,
  );
  const editErrors = normalizeErrors(
    historyItem?.supportStatus?.errors || historyItem?.error,
  );
  const canDownload = primaryStatus.key === "completed" && flattenedRows.length > 0;

  return (
    <Page
      fullWidth
      title={title}
      backAction={{ content: "History", onAction: handleBack }}
      titleMetadata={
        <InlineStack gap="200">
          <Badge {...statusBadge} />
          {undoBadge ? <Badge {...undoBadge} /> : null}
        </InlineStack>
      }
      secondaryActions={[
        {
          content: t("Download Logs"),
          onAction: handleDownloadLogs,
          disabled: !canDownload,
        },
      ]}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <Box padding="400">
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <InlineStack gap="200">
                    <Icon source={getStatusIcon(primaryStatus.key)} />
                    <Text variant="headingMd">{t("EditProgress")}</Text>
                  </InlineStack>
                  <Badge {...statusBadge} />
                </InlineStack>

                <ProgressBar
                  progress={Number(mainProgress.percent || 0)}
                  animated={isActiveStatus(primaryStatus)}
                  size="small"
                  tone={primaryStatus.key === "failed" ? "critical" : primaryStatus.key === "partial" ? "warning" : "primary"}
                />

                <InlineStack align="space-between">
                  <Text tone="subdued">
                    {mainProgress.label || `${mainProgress.current} / ${mainProgress.total || mainProgress.current}`}
                  </Text>

                  {Number(historyItem?.durationMs) > 0 ? (
                    <Text tone="subdued">
                      {t("Duration:")} {formatDuration(historyItem.durationMs)}
                    </Text>
                  ) : null}
                </InlineStack>

                {primaryStatus.detail ? (
                  <Text tone="subdued" variant="bodySm">
                    {primaryStatus.detail}
                  </Text>
                ) : null}

                {historyItem?.supportStatus?.failureStage ? (
                  <Text tone="subdued" variant="bodySm">
                    Failure stage: {historyItem.supportStatus.failureStage}
                  </Text>
                ) : null}

                {editErrors.length > 0 ? (
                  <Banner tone={primaryStatus.key === "partial" ? "warning" : "critical"}>
                    <BlockStack gap="200">
                      <Text>
                        {primaryStatus.key === "partial"
                          ? "The edit finished with recorded issues."
                          : "The edit recorded execution errors."}
                      </Text>
                      {editErrors.slice(0, 3).map((entry, index) => (
                        <Text key={index} tone="subdued" variant="bodySm">
                          - {entry?.message || entry?.code || "Unknown error"}
                        </Text>
                      ))}
                    </BlockStack>
                  </Banner>
                ) : null}
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>

        {undoStatus ? (
          <Layout.Section>
            <Card>
              <Box padding="400">
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <InlineStack gap="200">
                      <Icon source={getStatusIcon(undoStatus.key)} />
                      <Text variant="headingMd">Undo Progress</Text>
                    </InlineStack>
                    {undoBadge ? <Badge {...undoBadge} /> : null}
                  </InlineStack>

                  <ProgressBar
                    progress={
                      undoTotal > 0
                        ? Math.round((undoProcessed / undoTotal) * 100)
                        : undoStatus.key === "undo_completed"
                          ? 100
                          : 0
                    }
                    animated={isActiveStatus(undoStatus)}
                    size="small"
                    tone={undoStatus.key === "undo_failed" ? "critical" : undoStatus.key === "undo_partial" ? "warning" : "warning"}
                  />

                  <InlineStack align="space-between">
                    <Text tone="subdued">
                      {undoTotal > 0 ? `${undoProcessed} / ${undoTotal}` : `${undoProcessed}`}
                    </Text>

                    {Number(historyItem?.undo?.durationMs) > 0 ? (
                      <Text tone="subdued">
                        {t("Duration:")} {formatDuration(historyItem.undo.durationMs)}
                      </Text>
                    ) : null}
                  </InlineStack>

                  {undoStatus.detail ? (
                    <Text tone="subdued" variant="bodySm">
                      {undoStatus.detail}
                    </Text>
                  ) : null}

                  {undoErrors.length > 0 ? (
                    <Banner tone={undoStatus.key === "undo_partial" ? "warning" : "critical"}>
                      <BlockStack gap="200">
                        <Text>
                          {undoStatus.key === "undo_partial"
                            ? "Undo completed with recorded issues."
                            : "Undo encountered errors."}
                        </Text>
                        {undoErrors.slice(0, 3).map((entry, index) => (
                          <Text key={index} tone="subdued" variant="bodySm">
                            - {entry?.message || entry?.code || "Unknown error"}
                          </Text>
                        ))}
                      </BlockStack>
                    </Banner>
                  ) : null}
                </BlockStack>
              </Box>
            </Card>
          </Layout.Section>
        ) : null}

        <Layout.Section>
          <Card>
            <Box padding="400">
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text variant="headingMd">{t("ProductChanges")}</Text>
                  <Text tone="subdued">
                    {totalChanges > 0
                      ? `${t("Showing")} ${
                          (currentPage - 1) * itemsPerPage + 1
                        }-${Math.min(currentPage * itemsPerPage, totalChanges)} ${t("of")} ${totalChanges}`
                      : `${t("Showing")} 0-0 ${t("of")} 0`}
                  </Text>
                </InlineStack>
              </BlockStack>
            </Box>

            {isLoadingChanges ? (
              <Box padding="400">
                <InlineStack gap="200">
                  <Spinner size="small" />
                  <Text tone="subdued">{t("Loadingchanges")}</Text>
                </InlineStack>
              </Box>
            ) : changesError ? (
              <Box padding="400">
                <Banner tone="critical">{changesError}</Banner>
              </Box>
            ) : tableRows.length > 0 ? (
              <>
              <Box paddingInlineStart="60">
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={["Product", "Field", "Change"]}
                  rows={tableRows}
                /></Box>

                {totalPages > 1 ? (
                  <Box padding="400">
                    <InlineStack align="center" gap="300">
                      <Button
                        disabled={currentPage === 1}
                        onClick={() => fetchChanges(currentPage - 1)}
                      >
                        {t("Previous")}
                      </Button>

                      <Text>
                        {t("Page")} {currentPage} {t("of")} {totalPages}
                      </Text>

                      <Button
                        disabled={currentPage === totalPages}
                        onClick={() => fetchChanges(currentPage + 1)}
                      >
                        {t("Next")}
                      </Button>
                    </InlineStack>
                  </Box>
                ) : null}
              </>
            ) : (
              <EmptyState heading={t("Noproductschanged")} />
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
