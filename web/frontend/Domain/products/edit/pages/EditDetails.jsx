import React, { useState, useCallback, useEffect } from "react";
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
  CalendarIcon,
  RefreshIcon,
} from "@shopify/polaris-icons";
import Papa from "papaparse";
import { useTranslation } from "react-i18next";

const EditDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [historyItem, setHistoryItem] = useState(null);
  const [changes, setChanges] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isLoadingChanges, setIsLoadingChanges] = useState(true);
  const [error, setError] = useState(null);
  const [changesError, setChangesError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalChanges, setTotalChanges] = useState(0);
  const itemsPerPage = 10;

  /** Fetch history */
  useEffect(() => {
    const fetchHistoryDetails = async () => {
      if (!id) {
        setError("No history ID provided");
        setIsLoadingHistory(false);
        return;
      }

      try {
        setIsLoadingHistory(true);
        setError(null);
        const response = await fetch(
          `/api/history/get-edit-history-details/${id}`,
        );
        if (!response.ok) throw new Error(`Failed to fetch history`);
        const data = await response.json();
        setHistoryItem(data.data);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    fetchHistoryDetails();
  }, [id]);

  /** Fetch changes */
  const fetchChanges = async (page = 1) => {
    if (!id) return;
    try {
      setChangesError(null);
      setIsLoadingChanges(true);

      const response = await fetch(
        `/api/history/get-edit-history/changes/${id}?page=${page}&limit=${itemsPerPage}`,
      );
      if (!response.ok) throw new Error("Failed to fetch changes");

      const data = await response.json();
      setChanges(data.changes || []);
      setTotalPages(data.totalPages || 1);
      setTotalChanges(data.totalCount || 0);
      setCurrentPage(page);
    } catch (err) {
      setChangesError(err.message);
    } finally {
      setIsLoadingChanges(false);
    }
  };

  /** Initial fetch */
  useEffect(() => {
    fetchChanges(1);
  }, [id]);

  /** POLLING — continues even if API errors happen */
  useEffect(() => {
    if (!historyItem) return;

    const status = historyItem.status?.toLowerCase();
    const undoStatus = historyItem.undo?.status?.toLowerCase();

    const activeStatuses = ["pending", "processing"];

    // Check if either main status or undo status is active
    const isMainActive = activeStatuses.includes(status);
    const isUndoActive = activeStatuses.includes(undoStatus);

    if (!isMainActive && !isUndoActive) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/history/get-edit-history-details/${id}`);

        if (!res.ok) {
          console.warn("Polling failed, but continuing...");
          return;
        }

        const data = await res.json();
        const updated = data?.data;

        if (!updated) return;

        setHistoryItem(updated);

        const newStatus = updated.status?.toLowerCase();
        const newUndoStatus = updated.undo?.status?.toLowerCase();

        // Refresh changes when either operation completes
        if (newStatus === "completed" || newUndoStatus === "completed") {
          fetchChanges(currentPage);
        }

        // Stop polling if both operations are in final states
        const isMainStillActive = activeStatuses.includes(newStatus);
        const isUndoStillActive = activeStatuses.includes(newUndoStatus);

        if (!isMainStillActive && !isUndoStillActive) {
          clearInterval(interval);
        }
      } catch (err) {
        console.warn("Polling error:", err);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [historyItem, id, currentPage]);

  /** Navigation Handlers */
  const handleBack = useCallback(() => navigate("/history"), [navigate]);

  function formatDuration(ms = 0) {
    if (!ms || ms < 0) return "0s";

    const totalSeconds = Math.floor(ms / 1000);

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }

    return `${seconds}s`;
  }

  const handleDownloadLogs = useCallback(() => {
    if (changes.length === 0) return;

    // Flatten the nested structure for CSV export
    const csvData = [];

    changes.forEach((change) => {
      // Add product field changes
      change.productFieldChanges?.forEach((fieldChange) => {
        csvData.push({
          ProductTitle: change.title,
          ProductID: change.productId,
          Scope: "Product",
          Field: fieldChange.field,
          OldValue: fieldChange.oldValue,
          NewValue: fieldChange.newValue,
          Status: change.status,
          EditID: historyItem._id,
          Shop: historyItem.shop,
        });
      });

      // Add variant field changes
      change.variantFieldChanges?.forEach((variantChange) => {
        variantChange.changes?.forEach((fieldChange) => {
          csvData.push({
            ProductTitle: change.title,
            ProductID: change.productId,
            Scope: "Variant",
            VariantTitle: variantChange.variantTitle,
            VariantID: variantChange.variantId,
            Field: fieldChange.field,
            OldValue: fieldChange.oldValue,
            NewValue: fieldChange.newValue,
            Status: change.status,
            EditID: historyItem._id,
            Shop: historyItem.shop,
          });
        });
      });
    });

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `edit-history-${historyItem._id}-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [changes, historyItem]);

  /** Status badge for main operation */
  const getStatusBadge = () => {
    const s = historyItem?.status?.toLowerCase();

    if (s === "completed")
      return { tone: "success", children: "Completed", icon: CheckIcon };

    if (s === "failed")
      return { tone: "critical", children: "Failed", icon: XIcon };

    if (s === "processing")
      return { tone: "info", children: "Processing", icon: PlayIcon };

    if (s === "pending")
      return { tone: "attention", children: "Pending", icon: ClockIcon };

    return { tone: "subdued", children: historyItem?.status || "Unknown" };
  };

  /** Status badge for undo operation */
  const getUndoStatusBadge = () => {
    const s = historyItem?.undo?.status?.toLowerCase();

    if (s === "completed")
      return { tone: "success", children: "Undo Completed", icon: CheckIcon };

    if (s === "failed")
      return { tone: "critical", children: "Undo Failed", icon: XIcon };

    if (s === "processing")
      return { tone: "info", children: "Undo Processing", icon: PlayIcon };

    if (s === "pending")
      return { tone: "attention", children: "Undo Pending", icon: ClockIcon };

    if (s === "idle") return null; // Don't show badge for idle state

    return {
      tone: "subdued",
      children: historyItem?.undo?.status || "Unknown",
    };
  };

  const StatusIcon =
    {
      completed: CheckIcon,
      failed: XIcon,
      processing: PlayIcon,
      pending: ClockIcon,
    }[historyItem?.status?.toLowerCase()] || ClockIcon;

  const UndoStatusIcon =
    {
      completed: CheckIcon,
      failed: XIcon,
      processing: PlayIcon,
      pending: ClockIcon,
    }[historyItem?.undo?.status?.toLowerCase()] || RefreshIcon;

  /** Loading */
  if (isLoadingHistory)
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

  /** Error */
  if (error)
    return (
      <Page
        fullWidth
        title="Error"
        backAction={{ content: "History", onAction: handleBack }}
      >
        <Banner tone="critical">{error}</Banner>
      </Page>
    );

  if (!historyItem) return null;

  const { title, status, processedCount, totalItems, progressCount, undo } =
    historyItem;

  const actual = progressCount || processedCount || 0;
  const completion = totalItems ? Math.round((actual / totalItems) * 100) : 0;

  // Calculate undo progress
  const undoActual = undo?.processedCount || 0;
  const undoCompletion = totalItems
    ? Math.round((undoActual / totalItems) * 100)
    : 0;

  const canDownload =
    status?.toLowerCase() === "completed" && changes.length > 0;

  const undoBadge = getUndoStatusBadge();

  // Flatten the nested structure for display
  const flattenedRows = [];

  changes.forEach((change) => {
    // Add product field changes
    change.productFieldChanges?.forEach((fieldChange) => {
      flattenedRows.push({
        image: change.image,
        title: change.title,
        scope: t("scope.product"),
        field: fieldChange.field,
        oldValue: String(fieldChange.oldValue),
        newValue: String(fieldChange.newValue),
      });
    });

    // Add variant field changes
    change.variantFieldChanges?.forEach((variantChange) => {
      variantChange.changes?.forEach((fieldChange) => {
        flattenedRows.push({
          image: change.image,
          title: `${change.title} - ${variantChange.variantTitle}`,
          scope: t("scope.variant"),
          field: fieldChange.field,
          oldValue: String(fieldChange.oldValue),
          newValue: String(fieldChange.newValue),
        });
      });
    });
  });

  const rows = flattenedRows.map((item, index) => [
    <InlineStack key={index} gap="300" wrap={false}>
      <Thumbnail
        source={
          item.image || "https://www.otithee.com/img/fallback/fallback-2.png"
        }
        alt="product"
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
    <Text fontWeight="semibold">{item.field || "N/A"}</Text>,
    <BlockStack>
      <Text variant="bodyMd" tone="subdued" as="span">
        <s>{item.oldValue || "N/A"}</s>
      </Text>
      <Text>{item.newValue || "N/A"}</Text>
    </BlockStack>,
  ]);

  return (
    <Page
      fullWidth
      title={title || t("EditDetails")}
      backAction={{ content: "History", onAction: handleBack }}
      titleMetadata={
        <InlineStack gap="200">
          <Badge {...getStatusBadge()} />
          {undoBadge && <Badge {...undoBadge} />}
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
        {/* Main Edit Progress */}
        <Layout.Section>
          <Card>
            <Box padding="400">
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <InlineStack gap="200">
                    <Icon source={StatusIcon} />
                    <Text variant="headingMd">{t("EditProgress")}</Text>
                  </InlineStack>
                  <Badge {...getStatusBadge()} />
                </InlineStack>

                <ProgressBar
                  progress={completion}
                  animated={status?.toLowerCase() === "processing"}
                  size="small"
                  tone="primary"
                />

                <InlineStack align="space-between">
                  <Text tone="subdued">
                    {t("itemsProcessed", { actual, totalItems })}
                  </Text>
                  {historyItem.durationMs > 0 && (
                    <Text tone="subdued">
                      {t("Duration:")} {formatDuration(historyItem.durationMs)}
                    </Text>
                  )}
                </InlineStack>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>

        {/* Undo Progress - Only show if undo is not idle */}
        {undo && undo.status !== "idle" && (
          <Layout.Section>
            <Card>
              <Box padding="400">
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <InlineStack gap="200">
                      <Icon source={UndoStatusIcon} />
                      <Text variant="headingMd">Undo Progress</Text>
                    </InlineStack>
                    {undoBadge && <Badge {...undoBadge} />}
                  </InlineStack>

                  <ProgressBar
                    progress={undoCompletion}
                    animated={undo.status?.toLowerCase() === "processing"}
                    size="small"
                    tone="warning"
                  />

                  <InlineStack align="space-between">
                    <Text tone="subdued">
                      {undoActual} / {totalItems} items processed
                    </Text>
                    {undo.durationMs > 0 && (
                      <Text tone="subdued">
                        {t("Duration:")} {formatDuration(undo.durationMs)}
                      </Text>
                    )}
                  </InlineStack>

                  {undo.errors && undo.errors.length > 0 && (
                    <Banner tone="critical">
                      <BlockStack gap="200">
                        <Text>
                          Undo encountered {undo.errors.length} error(s):
                        </Text>
                        {undo.errors.slice(0, 3).map((err, idx) => (
                          <Text key={idx} tone="subdued" variant="bodySm">
                            • {err.message || err.code}
                          </Text>
                        ))}
                      </BlockStack>
                    </Banner>
                  )}
                </BlockStack>
              </Box>
            </Card>
          </Layout.Section>
        )}

        {/* Changes */}
        <Layout.Section>
          <Card>
            <Box padding="400">
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text variant="headingMd">{t("ProductChanges")}</Text>
                  <Text tone="subdued">
                    {t("Showing")} {(currentPage - 1) * itemsPerPage + 1}-
                    {Math.min(currentPage * itemsPerPage, totalChanges)}{" "}
                    {t("of")} {totalChanges}
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
            ) : rows.length > 0 ? (
              <>
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={["Product", "Field", "change"]}
                  rows={rows}
                />

                {totalPages > 1 && (
                  <Box padding="400">
                    <InlineStack align="center" gap="300">
                      <Button
                        disabled={currentPage === 1}
                        onClick={() => fetchChanges(currentPage - 1)}
                      >
                        {t("Previous")}
                      </Button>

                      <Text>
                        {t("Page")} {currentPage} of {totalPages}
                      </Text>

                      <Button
                        disabled={currentPage === totalPages}
                        onClick={() => fetchChanges(currentPage + 1)}
                      >
                        {t("Next")}
                      </Button>
                    </InlineStack>
                  </Box>
                )}
              </>
            ) : (
              <EmptyState heading={t("Noproductschanged")} />
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
};

export default EditDetails;