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

const FALLBACK_IMAGE = "https://www.otithee.com/img/fallback/fallback-2.png";
const ACTIVE_STATUSES = ["pending", "processing"];

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

function getStatusBadgeProps(status, fallbackLabel = "Unknown") {
  const normalized = String(status || "").toLowerCase();

  if (normalized === "completed") {
    return { tone: "success", children: "Completed", icon: CheckIcon };
  }

  if (normalized === "failed") {
    return { tone: "critical", children: "Failed", icon: XIcon };
  }

  if (normalized === "processing") {
    return { tone: "info", children: "Processing", icon: PlayIcon };
  }

  if (normalized === "pending") {
    return { tone: "attention", children: "Pending", icon: ClockIcon };
  }

  return {
    tone: "subdued",
    children: status || fallbackLabel,
  };
}

function getUndoStatusBadgeProps(status) {
  const normalized = String(status || "").toLowerCase();

  if (!normalized || normalized === "idle") return null;

  if (normalized === "completed") {
    return {
      tone: "success",
      children: "Undo Completed",
      icon: CheckIcon,
    };
  }

  if (normalized === "failed") {
    return {
      tone: "critical",
      children: "Undo Failed",
      icon: XIcon,
    };
  }

  if (normalized === "processing") {
    return {
      tone: "info",
      children: "Undo Processing",
      icon: PlayIcon,
    };
  }

  if (normalized === "pending") {
    return {
      tone: "attention",
      children: "Undo Pending",
      icon: ClockIcon,
    };
  }

  return {
    tone: "subdued",
    children: status || "Unknown",
  };
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

      // infer from actual returned rows instead of depending on old response fields
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

    const mainStatus = String(historyItem?.status || "").toLowerCase();
    const undoStatus = String(historyItem?.undo?.status || "").toLowerCase();

    const isMainActive = ACTIVE_STATUSES.includes(mainStatus);
    const isUndoActive = ACTIVE_STATUSES.includes(undoStatus);

    if (!isMainActive && !isUndoActive) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/history/get-edit-history-details/${id}`);
        if (!res.ok) return;

        const json = await res.json();
        const updated = json?.data;
        if (!updated) return;

        setHistoryItem(updated);

        const nextMainStatus = String(updated?.status || "").toLowerCase();
        const nextUndoStatus = String(updated?.undo?.status || "").toLowerCase();

        const mainCompletedNow = nextMainStatus === "completed";
        const undoCompletedNow = nextUndoStatus === "completed";

        if (mainCompletedNow || undoCompletedNow) {
          fetchChanges(currentPage);
        }

        const stillMainActive = ACTIVE_STATUSES.includes(nextMainStatus);
        const stillUndoActive = ACTIVE_STATUSES.includes(nextUndoStatus);

        if (!stillMainActive && !stillUndoActive) {
          clearInterval(interval);
        }
      } catch (pollErr) {
        console.warn("Polling error:", pollErr);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [historyItem?.id, historyItem?.status, historyItem?.undo?.status, id, currentPage, fetchChanges]);

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

  const tableRows = useMemo(() => {
    return flattenedRows.map((item, index) => [
      <InlineStack key={`product-cell-${index}`} gap="300" wrap={false}>
        <Thumbnail
          source={item.image || FALLBACK_IMAGE}
          alt={item.title || "product"}
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
    ]);
  }, [flattenedRows]);

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
      Status: historyItem.status || "",
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
  const status = historyItem?.status || "Unknown";
  const processedCount = Number(historyItem?.processedCount) || 0;
  const totalItems = Number(historyItem?.totalItems) || 0;
  const progressCount = Number(historyItem?.progressCount) || 0;
  const undo = historyItem?.undo || null;

  const actual = progressCount || processedCount || 0;
  const completion = totalItems > 0 ? Math.round((actual / totalItems) * 100) : 0;

  const undoActual = Number(undo?.processedCount) || 0;
  const undoCompletion =
    totalItems > 0 ? Math.round((undoActual / totalItems) * 100) : 0;

  const canDownload =
    String(status).toLowerCase() === "completed" && flattenedRows.length > 0;

  const statusBadge = getStatusBadgeProps(status);
  const undoBadge = getUndoStatusBadgeProps(undo?.status);

  const StatusIcon =
    {
      completed: CheckIcon,
      failed: XIcon,
      processing: PlayIcon,
      pending: ClockIcon,
    }[String(status).toLowerCase()] || ClockIcon;

  const UndoStatusIcon =
    {
      completed: CheckIcon,
      failed: XIcon,
      processing: PlayIcon,
      pending: ClockIcon,
    }[String(undo?.status).toLowerCase()] || RefreshIcon;

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
                    <Icon source={StatusIcon} />
                    <Text variant="headingMd">{t("EditProgress")}</Text>
                  </InlineStack>
                  <Badge {...statusBadge} />
                </InlineStack>

                <ProgressBar
                  progress={completion}
                  animated={String(status).toLowerCase() === "processing"}
                  size="small"
                  tone="primary"
                />

                <InlineStack align="space-between">
                  <Text tone="subdued">
                    {t("itemsProcessed", { actual, totalItems })}
                  </Text>

                  {Number(historyItem?.durationMs) > 0 ? (
                    <Text tone="subdued">
                      {t("Duration:")} {formatDuration(historyItem.durationMs)}
                    </Text>
                  ) : null}
                </InlineStack>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>

        {undo && String(undo?.status || "").toLowerCase() !== "idle" ? (
          <Layout.Section>
            <Card>
              <Box padding="400">
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <InlineStack gap="200">
                      <Icon source={UndoStatusIcon} />
                      <Text variant="headingMd">Undo Progress</Text>
                    </InlineStack>
                    {undoBadge ? <Badge {...undoBadge} /> : null}
                  </InlineStack>

                  <ProgressBar
                    progress={undoCompletion}
                    animated={String(undo?.status).toLowerCase() === "processing"}
                    size="small"
                    tone="warning"
                  />

                  <InlineStack align="space-between">
                    <Text tone="subdued">
                      {undoActual} / {totalItems} items processed
                    </Text>

                    {Number(undo?.durationMs) > 0 ? (
                      <Text tone="subdued">
                        {t("Duration:")} {formatDuration(undo.durationMs)}
                      </Text>
                    ) : null}
                  </InlineStack>

                  {Array.isArray(undo?.errors) && undo.errors.length > 0 ? (
                    <Banner tone="critical">
                      <BlockStack gap="200">
                        <Text>
                          Undo encountered {undo.errors.length} error(s):
                        </Text>
                        {undo.errors.slice(0, 3).map((err, idx) => (
                          <Text key={idx} tone="subdued" variant="bodySm">
                            • {err?.message || err?.code || "Unknown error"}
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
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={["Product", "Field", "Change"]}
                  rows={tableRows}
                />

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