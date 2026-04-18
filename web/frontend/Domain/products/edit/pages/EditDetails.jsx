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

function formatDuration(ms = 0, t) {
  if (!ms || ms < 0) return `0${t("common.seconds", { defaultValue: "s" })}`;

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}${t("common.seconds", { defaultValue: "s" })}`;
}

function getPrimaryStatus(historyItem) {
  if (historyItem?.primaryStatus) {
    return historyItem.primaryStatus;
  }

  const status = String(historyItem?.status || "").toLowerCase();

  if (status === "completed") {
    return { key: "completed", tone: "success", isTerminal: true };
  }
  if (status === "failed") {
    return { key: "failed", tone: "critical", isTerminal: true };
  }
  if (status === "finalizing") {
    return { key: "finalizing", tone: "info", isTerminal: false };
  }
  if (status === "dispatching") {
    return { key: "dispatching", tone: "info", isTerminal: false };
  }
  if (status === "awaiting_shopify") {
    return { key: "awaiting_shopify", tone: "info", isTerminal: false };
  }
  if (status === "running") {
    return { key: "running", tone: "info", isTerminal: false };
  }
  if (status === "processing") {
    return { key: "processing", tone: "info", isTerminal: false };
  }
  if (status === "queued") {
    return { key: "queued", tone: "attention", isTerminal: false };
  }
  if (status === "partial") {
    return { key: "partial", tone: "warning", isTerminal: true };
  }
  if (status === "cancelled") {
    return { key: "cancelled", tone: "warning", isTerminal: true };
  }

  return { key: "pending", tone: "attention", isTerminal: false };
}

function getUndoStatus(historyItem) {
  if (historyItem?.undoStatusSummary) {
    return historyItem.undoStatusSummary;
  }

  const undoStatus = String(historyItem?.undo?.status || "").toLowerCase();

  if (!undoStatus || undoStatus === "idle") return null;

  if (undoStatus === "completed") {
    return { key: "undo_completed", tone: "success", isTerminal: true };
  }
  if (undoStatus === "failed") {
    return { key: "undo_failed", tone: "critical", isTerminal: true };
  }
  if (undoStatus === "queued") {
    return { key: "undo_queued", tone: "attention", isTerminal: false };
  }
  if (undoStatus === "dispatching") {
    return { key: "undo_dispatching", tone: "info", isTerminal: false };
  }
  if (undoStatus === "awaiting_shopify") {
    return { key: "undo_awaiting_shopify", tone: "info", isTerminal: false };
  }
  if (undoStatus === "finalizing") {
    return { key: "undo_finalizing", tone: "info", isTerminal: false };
  }
  if (undoStatus === "partial") {
    return { key: "undo_partial", tone: "warning", isTerminal: true };
  }
  if (undoStatus === "cancelled") {
    return { key: "undo_cancelled", tone: "warning", isTerminal: true };
  }

  return { key: "undo_processing", tone: "info", isTerminal: false };
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

function safeToString(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") {
    return value.text ?? value.label ?? value.value ?? JSON.stringify(value);
  }
  return String(value);
}

export default function EditDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

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

  const getStatusLabel = useCallback(
    (status) => {
      if (!status?.key) return "";

      return t(`historyStatus.${status.key}`, {
        defaultValue: status?.label || status.key,
      });
    },
    [t],
  );

  const getStatusDetail = useCallback(
    (status) => {
      if (!status?.key) return null;

      return t(`historyStatusDetail.${status.key}`, {
        defaultValue: status?.detail || "",
      });
    },
    [t],
  );

  const getFieldLabel = useCallback(
    (field) => {
      if (!field) {
        return t("field", { defaultValue: "Field" });
      }

      return t(`fieldLabels.${field}`, {
        defaultValue: field,
      });
    },
    [t],
  );

  const getPageTitle = useCallback(
    (item) => {
      if (!item) {
        return t("EditDetails", { defaultValue: "Edit Details" });
      }

      if (item?.titleKey) {
        return t(item.titleKey, {
          ...(item.titleParams || {}),
          defaultValue: item?.title || t("EditDetails", { defaultValue: "Edit Details" }),
        });
      }

      if (item?.title) {
        return item.title;
      }

      return t("EditDetails", { defaultValue: "Edit Details" });
    },
    [t],
  );

  const fetchHistoryDetails = useCallback(async () => {
    if (!id) {
      setError(
        t("loadingDetails", {
          defaultValue: "No history ID provided",
        }),
      );
      setIsLoadingHistory(false);
      return;
    }

    try {
      setIsLoadingHistory(true);
      setError(null);

      const response = await fetch(
        `/api/history/get-edit-history-details/${id}?lang=${encodeURIComponent(i18n.language)}`,
      );

      if (!response.ok) {
        throw new Error(
          t("loadingHistoryDetails", {
            defaultValue: "Failed to fetch history",
          }),
        );
      }

      const json = await response.json();
      setHistoryItem(json?.data || null);
    } catch (err) {
      setError(
        err?.message ||
          t("loadingHistoryDetails", {
            defaultValue: "Failed to fetch history",
          }),
      );
    } finally {
      setIsLoadingHistory(false);
    }
  }, [id, i18n.language, t]);

  const fetchChanges = useCallback(
    async (page = 1) => {
      if (!id) return;

      try {
        setChangesError(null);
        setIsLoadingChanges(true);

        const response = await fetch(
          `/api/history/get-edit-history/changes/${id}?page=${page}&limit=${itemsPerPage}&lang=${encodeURIComponent(i18n.language)}`,
        );

        if (!response.ok) {
          throw new Error(
            t("loadingChanges", {
              defaultValue: "Failed to fetch changes",
            }),
          );
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
        setChangesError(
          err?.message ||
            t("loadingChanges", {
              defaultValue: "Failed to fetch changes",
            }),
        );
      } finally {
        setIsLoadingChanges(false);
      }
    },
    [id, i18n.language, t],
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
        const res = await fetch(
          `/api/history/get-edit-history-details/${id}?lang=${encodeURIComponent(i18n.language)}`,
        );

        if (!res.ok) return;

        const json = await res.json();
        const updated = json?.data;
        if (!updated) return;

        setHistoryItem(updated);

        const nextPrimaryStatus = getPrimaryStatus(updated);
        const nextUndoStatus = getUndoStatus(updated);

        if (
          nextPrimaryStatus.key === "completed" ||
          nextPrimaryStatus.key === "partial" ||
          nextUndoStatus?.key === "undo_completed" ||
          nextUndoStatus?.key === "undo_partial"
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
  }, [historyItem, id, currentPage, fetchChanges, i18n.language]);

  const flattenedRows = useMemo(() => {
    if (!Array.isArray(changes) || changes.length === 0) return [];

    return changes.flatMap((change) => {
      const productTitle =
        getPageTitle(change) ||
        change?.title ||
        t("product", { defaultValue: "Product" });

      const productImage = change?.image || "";

      const productRows = Array.isArray(change?.productFieldChanges)
        ? change.productFieldChanges.map((fieldChange) => ({
            image: productImage,
            title: productTitle,
            scope: t("scope.product", { defaultValue: "Product" }),
            field: getFieldLabel(fieldChange?.field || changeField),
            oldValue:
              fieldChange?.oldValue !== undefined && fieldChange?.oldValue !== null
                ? safeToString(fieldChange.oldValue)
                : "-",
            newValue:
              fieldChange?.newValue !== undefined && fieldChange?.newValue !== null
                ? safeToString(fieldChange.newValue)
                : "-",
          }))
        : [];

      const variantRows = Array.isArray(change?.variantFieldChanges)
        ? change.variantFieldChanges.flatMap((variantChange) => {
            if (!Array.isArray(variantChange?.changes)) return [];

            const variantTitle =
              variantChange?.variantTitle ||
              t("variantTitle", { defaultValue: "Default Title" });

            return variantChange.changes.map((fieldChange) => ({
              image: productImage,
              title: `${productTitle} - ${variantTitle}`,
              scope: t("scope.variant", { defaultValue: "Variant" }),
              field: getFieldLabel(fieldChange?.field || changeField),
              oldValue:
                fieldChange?.oldValue !== undefined && fieldChange?.oldValue !== null
                  ? safeToString(fieldChange.oldValue)
                  : "-",
              newValue:
                fieldChange?.newValue !== undefined && fieldChange?.newValue !== null
                  ? safeToString(fieldChange.newValue)
                  : "-",
            }));
          })
        : [];

      return [...productRows, ...variantRows];
    });
  }, [changes, changeField, getFieldLabel, getPageTitle, t, isVariantChange]);

  const tableRows = useMemo(
    () =>
      flattenedRows.map((item, index) => [
        <InlineStack key={`product-cell-${index}`} gap="300" wrap={false}>
          <Thumbnail
            source={item.image || FALLBACK_IMAGE}
            alt={item.title || t("product", { defaultValue: "product" })}
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
    [flattenedRows, t],
  );

  const handleDownloadLogs = useCallback(() => {
    if (!historyItem?.id || flattenedRows.length === 0) return;

    const primaryStatus = getPrimaryStatus(historyItem);

    const csvData = flattenedRows.map((row) => ({
      ProductTitle: row.title,
      Scope: row.scope,
      Field: row.field,
      OldValue: row.oldValue,
      NewValue: row.newValue,
      EditID: historyItem.id,
      Shop: historyItem.shop || "",
      Status: getStatusLabel(primaryStatus),
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
  }, [flattenedRows, historyItem, getStatusLabel]);

  if (isLoadingHistory) {
    return (
      <Page
        fullWidth
        title={t("loadingDetails", { defaultValue: "Loading Details..." })}
        backAction={{
          content: t("History", { defaultValue: "History" }),
          onAction: handleBack,
        }}
      >
        <Layout>
          <Layout.Section>
            <Card>
              <Box padding="500">
                <InlineStack align="center" gap="300">
                  <Spinner size="large" />
                  <Text tone="subdued">
                    {t("loadingHistoryDetails", {
                      defaultValue: "Loading history details...",
                    })}
                  </Text>
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
        title={t("error", { defaultValue: "Error" })}
        backAction={{
          content: t("History", { defaultValue: "History" }),
          onAction: handleBack,
        }}
      >
        <Banner tone="critical">{error}</Banner>
      </Page>
    );
  }

  if (!historyItem) return null;

  const title = getPageTitle(historyItem);
  const primaryStatus = getPrimaryStatus(historyItem);
  const undoStatus = getUndoStatus(historyItem);
  const primaryStatusLabel = getStatusLabel(primaryStatus);
  const undoStatusLabel = undoStatus ? getStatusLabel(undoStatus) : null;
  const primaryDetail = getStatusDetail(primaryStatus);
  const undoDetail = undoStatus ? getStatusDetail(undoStatus) : null;

  const statusBadge = {
    tone: primaryStatus.tone,
    children: primaryStatusLabel,
  };

  const undoBadge = undoStatus
    ? {
        tone: undoStatus.tone,
        children: undoStatusLabel,
      }
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
      backAction={{
        content: t("History", { defaultValue: "History" }),
        onAction: handleBack,
      }}
      titleMetadata={
        <InlineStack gap="200">
          <Badge tone={statusBadge.tone}>{statusBadge.children}</Badge>
          {undoBadge ? <Badge tone={undoBadge.tone}>{undoBadge.children}</Badge> : null}
        </InlineStack>
      }
      secondaryActions={[
        {
          content: t("Download Logs", { defaultValue: "Download Logs" }),
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
                    <Text variant="headingMd">
                      {t("EditProgress", { defaultValue: "Edit Progress" })}
                    </Text>
                  </InlineStack>
                  <Badge tone={statusBadge.tone}>{statusBadge.children}</Badge>
                </InlineStack>

                <ProgressBar
                  progress={Number(mainProgress.percent || 0)}
                  animated={isActiveStatus(primaryStatus)}
                  size="small"
                  tone={
                    primaryStatus.key === "failed"
                      ? "critical"
                      : primaryStatus.key === "partial"
                        ? "warning"
                        : "primary"
                  }
                />

                <InlineStack align="space-between">
                  <Text tone="subdued">
                    {mainProgress.label ||
                      `${mainProgress.current} / ${mainProgress.total || mainProgress.current}`}
                  </Text>

                  {Number(historyItem?.durationMs) > 0 ? (
                    <Text tone="subdued">
                      {t("Duration", { defaultValue: "Duration" })}:{" "}
                      {formatDuration(historyItem.durationMs, t)}
                    </Text>
                  ) : null}
                </InlineStack>

                {primaryDetail ? (
                  <Text tone="subdued" variant="bodySm">
                    {primaryDetail}
                  </Text>
                ) : null}

                {historyItem?.supportStatus?.failureStage ? (
                  <Text tone="subdued" variant="bodySm">
                    {t("failureStage", { defaultValue: "Failure stage" })}:{" "}
                    {historyItem.supportStatus.failureStage}
                  </Text>
                ) : null}

                {editErrors.length > 0 ? (
                  <Banner tone={primaryStatus.key === "partial" ? "warning" : "critical"}>
                    <BlockStack gap="200">
                      <Text>
                        {primaryStatus.key === "partial"
                          ? t("partial_msg", {
                              defaultValue: "The edit finished with recorded issues.",
                            })
                          : t("update_failed", {
                              defaultValue: "The edit recorded execution errors.",
                            })}
                      </Text>
                      {editErrors.slice(0, 3).map((entry, index) => (
                        <Text key={index} tone="subdued" variant="bodySm">
                          - {entry?.message || entry?.code || t("unexpected", { defaultValue: "Unknown error" })}
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
                      <Text variant="headingMd">
                        {t("undoEdit", { defaultValue: "Undo Progress" })}
                      </Text>
                    </InlineStack>
                    {undoBadge ? <Badge tone={undoBadge.tone}>{undoBadge.children}</Badge> : null}
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
                    tone={
                      undoStatus.key === "undo_failed"
                        ? "critical"
                        : undoStatus.key === "undo_partial"
                          ? "warning"
                          : "warning"
                    }
                  />

                  <InlineStack align="space-between">
                    <Text tone="subdued">
                      {undoTotal > 0 ? `${undoProcessed} / ${undoTotal}` : `${undoProcessed}`}
                    </Text>

                    {Number(historyItem?.undo?.durationMs) > 0 ? (
                      <Text tone="subdued">
                        {t("Duration", { defaultValue: "Duration" })}:{" "}
                        {formatDuration(historyItem.undo.durationMs, t)}
                      </Text>
                    ) : null}
                  </InlineStack>

                  {undoDetail ? (
                    <Text tone="subdued" variant="bodySm">
                      {undoDetail}
                    </Text>
                  ) : null}

                  {undoErrors.length > 0 ? (
                    <Banner tone={undoStatus.key === "undo_partial" ? "warning" : "critical"}>
                      <BlockStack gap="200">
                        <Text>
                          {undoStatus.key === "undo_partial"
                            ? t("undoPartiallyCompletedDetail", {
                                defaultValue: "Undo completed with recorded issues.",
                              })
                            : t("undoFailed", {
                                defaultValue: "Undo encountered errors.",
                              })}
                        </Text>
                        {undoErrors.slice(0, 3).map((entry, index) => (
                          <Text key={index} tone="subdued" variant="bodySm">
                            - {entry?.message || entry?.code || t("unexpected", { defaultValue: "Unknown error" })}
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
                  <Text variant="headingMd">
                    {t("ProductChanges", { defaultValue: "Product Changes" })}
                  </Text>
                  <Text tone="subdued">
                    {totalChanges > 0
                      ? `${t("Showing", { defaultValue: "Showing" })} ${
                          (currentPage - 1) * itemsPerPage + 1
                        }-${Math.min(currentPage * itemsPerPage, totalChanges)} ${t("of", {
                          defaultValue: "of",
                        })} ${totalChanges}`
                      : `${t("Showing", { defaultValue: "Showing" })} 0-0 ${t("of", {
                          defaultValue: "of",
                        })} 0`}
                  </Text>
                </InlineStack>
              </BlockStack>
            </Box>

            {isLoadingChanges ? (
              <Box padding="400">
                <InlineStack gap="200">
                  <Spinner size="small" />
                  <Text tone="subdued">
                    {t("Loadingchanges", { defaultValue: "Loading changes..." })}
                  </Text>
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
                    headings={[
                      t("table.product", { defaultValue: "Product" }),
                      t("table.field", { defaultValue: "Field" }),
                      t("table.change", { defaultValue: "Change" }),
                    ]}
                    rows={tableRows}
                  />
                </Box>

                {totalPages > 1 ? (
                  <Box padding="400">
                    <InlineStack align="center" gap="300">
                      <Button
                        disabled={currentPage === 1}
                        onClick={() => fetchChanges(currentPage - 1)}
                      >
                        {t("Previous", { defaultValue: "Previous" })}
                      </Button>

                      <Text>
                        {t("Page", { defaultValue: "Page" })} {currentPage} {t("of", { defaultValue: "of" })}{" "}
                        {totalPages}
                      </Text>

                      <Button
                        disabled={currentPage === totalPages}
                        onClick={() => fetchChanges(currentPage + 1)}
                      >
                        {t("Next", { defaultValue: "Next" })}
                      </Button>
                    </InlineStack>
                  </Box>
                ) : null}
              </>
            ) : (
              <EmptyState
                heading={t("Noproductschanged", {
                  defaultValue: "No products changed",
                })}
              />
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}