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
import { useAuthenticatedFetch } from "../../../../hooks/useAuthenticatedFetch";

const FALLBACK_IMAGE = "https://www.otithee.com/img/fallback/fallback-2.png";
const ESTIMATED_PRODUCTS_PER_SECOND = 125;

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
  if (historyItem?.primaryStatus?.key) {
    return {
      key: historyItem.primaryStatus.key,
      tone: historyItem.primaryStatus.tone || "info",
      isTerminal: historyItem.primaryStatus.isTerminal === true,
    };
  }

  const status = String(historyItem?.status || "").toLowerCase();

  if (status === "completed") {
    return { key: "completed", tone: "success", isTerminal: true };
  }

  if (status === "failed") {
    return { key: "failed", tone: "critical", isTerminal: true };
  }

  if (status === "processing") {
    return { key: "processing", tone: "info", isTerminal: false };
  }

  return { key: "pending", tone: "attention", isTerminal: false };
}

function getUndoStatus(historyItem) {
  if (historyItem?.undoStatusSummary?.key) {
    return {
      key: historyItem.undoStatusSummary.key,
      tone: historyItem.undoStatusSummary.tone || "info",
      isTerminal: historyItem.undoStatusSummary.isTerminal === true,
    };
  }

  const undoStatus = String(historyItem?.undo?.status || "").toLowerCase();
  if (!undoStatus || undoStatus === "idle") return null;

  if (undoStatus === "completed") {
    return { key: "undo_completed", tone: "success", isTerminal: true };
  }

  if (undoStatus === "failed") {
    return { key: "undo_failed", tone: "critical", isTerminal: true };
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

function formatCount(value, language) {
  return Number(value || 0).toLocaleString(language);
}

function getEstimatedBulkEditMs(count) {
  const numericCount = Number(count || 0);
  if (numericCount <= 0) return 0;
  return Math.max(20, Math.ceil(numericCount / ESTIMATED_PRODUCTS_PER_SECOND)) * 1000;
}

function getFailureProductLabel(entry) {
  return (
    entry?.productTitle ||
    entry?.title ||
    entry?.product ||
    entry?.productId ||
    entry?.id ||
    "Shopify bulk operation"
  );
}

function getFailureMessage(entry) {
  return entry?.message || entry?.error || entry?.code || "Unknown error";
}

export default function EditDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
const { t, i18n } = useTranslation();
  const fetchWithAuth = useAuthenticatedFetch();
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
  const [showFailureInspector, setShowFailureInspector] = useState(false);
  const [cancelScheduledLoading, setCancelScheduledLoading] = useState(false);
  const [downloadUndoConflictsLoading, setDownloadUndoConflictsLoading] = useState(false);
  const changesSectionRef = React.useRef(null);
  const failuresSectionRef = React.useRef(null);

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

const response = await fetchWithAuth(
  `/api/history/get-edit-history-details/${id}?lang=${i18n.language}`
);
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
  }, [fetchWithAuth, id, i18n.language]);

  const fetchChanges = useCallback(
    async (page = 1) => {
      if (!id) return;

      try {
        setChangesError(null);
        setIsLoadingChanges(true);

        const response = await fetchWithAuth(
  `/api/history/get-edit-history/changes/${id}?page=${page}&limit=${itemsPerPage}&lang=${i18n.language}`
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
    [fetchWithAuth, id, i18n.language],
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
        const res = await fetchWithAuth(`/api/history/get-edit-history-details/${id}?lang=${i18n.language}`);

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
  }, [fetchWithAuth, historyItem, id, i18n.language, currentPage, fetchChanges]);

  const flattenedRows = useMemo(() => {
    if (!Array.isArray(changes) || changes.length === 0) return [];

    return changes.flatMap((change) => {
      const productTitle = change?.title || "Untitled product";
      const productImage = change?.image || "";

  const productRows = Array.isArray(change?.productFieldChanges)
  ? change.productFieldChanges.map((fieldChange) => {
      const rawField = fieldChange?.field || changeField || "N/A";  // ✅ store raw first
      return {
        image: productImage,
        title: productTitle,
        scope: t("scope.product"),
        field: t(`fieldLabels.${rawField}`, { defaultValue: rawField }),  // ✅ translate
        oldValue:
          fieldChange?.oldValue !== undefined && fieldChange?.oldValue !== null
            ? String(fieldChange.oldValue)
            : "N/A",
        newValue:
          fieldChange?.newValue !== undefined && fieldChange?.newValue !== null
            ? String(fieldChange.newValue)
            : "N/A",
      };
    })
  : [];

      const variantRows = Array.isArray(change?.variantFieldChanges)
  ? change.variantFieldChanges.flatMap((variantChange) => {
      if (!Array.isArray(variantChange?.changes)) return [];
      return variantChange.changes.map((fieldChange) => {
        const rawField = fieldChange?.field || changeField || "N/A";  // ✅ store raw first
        return {
          image: productImage,
          title: `${productTitle} - ${variantChange?.variantTitle || "Default Title"}`,
          scope: t("scope.variant"),
          field: t(`fieldLabels.${rawField}`, { defaultValue: rawField }),  // ✅ translate
          oldValue:
            fieldChange?.oldValue !== undefined && fieldChange?.oldValue !== null
              ? String(fieldChange.oldValue)
              : "N/A",
          newValue:
            fieldChange?.newValue !== undefined && fieldChange?.newValue !== null
              ? String(fieldChange.newValue)
              : "N/A",
        };
      });
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
      ]),
    [flattenedRows],
  );

  const timelineRows = useMemo(() => {
    if (!historyItem) return [];

    const status = getPrimaryStatus(historyItem);
    const targetCount = Number(
      historyItem?.supportStatus?.targetSnapshotCount ||
        historyItem?.targetSnapshotCount ||
        historyItem?.totalItems ||
        0,
    );
    const processedCount = Number(
      historyItem?.progressSummary?.current ||
        historyItem?.progressCount ||
        historyItem?.processedCount ||
        0,
    );
    const errors = normalizeErrors(
      historyItem?.supportStatus?.errors || historyItem?.error,
    );
    const failedCount = errors.length;
    const succeededCount = Math.max(processedCount - failedCount, 0);
    const undoAllowed =
      historyItem?.supportStatus?.undoAllowed === true ||
      historyItem?.undo?.allowed === true;
    const currentUndoStatus = getUndoStatus(historyItem);
    const hasStartedShopify = [
      "awaiting_shopify",
      "finalizing",
      "completed",
      "partial",
      "failed",
      "cancelled",
    ].includes(status.key);
    const hasSucceeded =
      processedCount > 0 ||
      ["completed", "partial"].includes(status.key);
    const isComplete = ["completed", "partial"].includes(status.key);

    return [
      {
        key: "target_frozen",
        icon: CheckIcon,
        tone: "success",
        title: t("timelineTargetFrozen", {
          count: formatCount(targetCount, i18n.language),
          defaultValue: `Target frozen (${formatCount(
            targetCount,
            i18n.language,
          )} products)`,
        }),
      },
      {
        key: "shopify_started",
        icon: hasStartedShopify ? CheckIcon : PlayIcon,
        tone: hasStartedShopify ? "success" : "info",
        title: t("timelineShopifyMutationStarted", {
          defaultValue: "Shopify mutation started",
        }),
        pending: !hasStartedShopify,
      },
      {
        key: "succeeded",
        icon: hasSucceeded ? CheckIcon : ClockIcon,
        tone: hasSucceeded ? "success" : "subdued",
        title: t("timelineSucceeded", {
          count: formatCount(succeededCount || processedCount, i18n.language),
          defaultValue: `${formatCount(
            succeededCount || processedCount,
            i18n.language,
          )} succeeded`,
        }),
        pending: !hasSucceeded,
      },
      {
        key: "failed",
        icon: failedCount > 0 ? XIcon : CheckIcon,
        tone: failedCount > 0 ? "critical" : "success",
        title: t("timelineFailed", {
          count: formatCount(failedCount, i18n.language),
          defaultValue: `${formatCount(failedCount, i18n.language)} failed`,
        }),
        action:
          failedCount > 0
            ? {
                content: t("view", { defaultValue: "view" }),
                onAction: () => {
                  setShowFailureInspector(true);
                  failuresSectionRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  });
                },
              }
            : null,
      },
      {
        key: "completed",
        icon: isComplete ? CheckIcon : ClockIcon,
        tone: isComplete ? "success" : "subdued",
        title:
          isComplete && Number(historyItem?.durationMs) > 0
            ? t("timelineCompletedIn", {
                duration: formatDuration(historyItem.durationMs),
                defaultValue: `Completed in ${formatDuration(
                  historyItem.durationMs,
                )}`,
              })
            : t("timelineCompletionPending", {
                defaultValue: "Completion pending",
              }),
        pending: !isComplete,
      },
      {
        key: "undo",
        icon:
          currentUndoStatus?.key === "undo_completed"
            ? CheckIcon
            : undoAllowed
              ? RefreshIcon
              : XIcon,
        tone:
          currentUndoStatus?.key === "undo_completed"
            ? "success"
            : undoAllowed
              ? "info"
              : "subdued",
        title: currentUndoStatus
          ? t(`historyStatus.${currentUndoStatus.key}`, {
              defaultValue: currentUndoStatus.key,
            })
          : undoAllowed
            ? t("timelineUndoAvailable", {
                defaultValue: "Undo available",
              })
            : t("timelineUndoUnavailable", {
                defaultValue: "Undo unavailable",
              }),
      },
    ];
  }, [historyItem, i18n.language, t]);

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

  const undoRequestId =
    historyItem?.supportStatus?.undoSummaryBuckets?.undoRequestId ||
    historyItem?.supportStatus?.undoRequestId ||
    null;

  const handleDownloadUndoConflicts = useCallback(async () => {
    if (!undoRequestId) return;

    setDownloadUndoConflictsLoading(true);
    try {
      const response = await fetchWithAuth(
        `/api/history/undo-conflicts/${undoRequestId}.csv`,
      );

      if (!response.ok) {
        throw new Error("Failed to download undo conflicts CSV");
      }

      const csvText = await response.text();
      const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = `undo-conflicts-${undoRequestId}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError?.message || "Failed to download undo conflicts CSV");
    } finally {
      setDownloadUndoConflictsLoading(false);
    }
  }, [fetchWithAuth, undoRequestId]);

  const resolveScheduledExecutionState = useCallback((item) => {
    const raw = String(item?.executionState || item?.status || "").toUpperCase();
    if (["PENDING", "PLANNED"].includes(raw)) return "PENDING";
    if (["CLAIMED", "SNAPSHOTTING", "SNAPSHOTTED"].includes(raw)) return "CLAIMED";
    if (["EXECUTING", "DISPATCHING"].includes(raw)) return "EXECUTING";
    if (["AWAITING_SHOPIFY"].includes(raw)) return "AWAITING_SHOPIFY";
    if (["COMPLETED"].includes(raw)) return "COMPLETED";
    if (["FAILED"].includes(raw)) return "FAILED";
    if (["CANCELLED"].includes(raw)) return "CANCELLED";
    return raw || "PENDING";
  }, []);

  const scheduledState = resolveScheduledExecutionState(historyItem);
  const isScheduledEdit = String(historyItem?.type || "").toLowerCase() === "scheduled edit";
  const canCancelScheduled = isScheduledEdit && scheduledState === "PENDING";

  const handleCancelScheduledEdit = useCallback(async () => {
    if (!historyItem?.id || !canCancelScheduled) return;
    try {
      setCancelScheduledLoading(true);
      const response = await fetchWithAuth(`/api/products/schedule-task/${historyItem.id}`, {
        method: "DELETE",
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.message || "Failed to cancel scheduled edit");
      }
      await fetchHistoryDetails();
    } catch (cancelError) {
      setError(cancelError.message || "Failed to cancel scheduled edit");
    } finally {
      setCancelScheduledLoading(false);
    }
  }, [canCancelScheduled, fetchHistoryDetails, fetchWithAuth, historyItem?.id]);

  if (isLoadingHistory) {
    return (
      <Page
        fullWidth
        title={t("loadingHistoryDetails")}
        backAction={{ content: t("History"), onAction: handleBack }}
      >
        <Layout>
          <Layout.Section>
            <Card>
              <Box padding="500">
                <InlineStack align="center" gap="300">
                  <Spinner size="large" />
                  <Text tone="subdued">{t("loadingHistoryDetailsSpinner")}</Text>
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
        title={t("errorPageTitle")}
        backAction={{ content: t("History"), onAction: handleBack }}
      >
        <Banner tone="critical">{error}</Banner>
      </Page>
    );
  }

  if (!historyItem) return null;



const title = historyItem?.titleKey
  ? t(historyItem.titleKey, {
      ...(historyItem.titleParams || {}),
      defaultValue: historyItem?.title || "",
    })
  : historyItem?.title || "";

      const primaryStatus = getPrimaryStatus(historyItem);
  const undoStatus = getUndoStatus(historyItem);
  const primaryStatusLabel = t(`historyStatus.${primaryStatus.key}`, {
  defaultValue: primaryStatus.key,
});

const primaryStatusDetail = t(`historyStatusDetail.${primaryStatus.key}`, {
  defaultValue: "",
});

const statusBadge = {
  tone: primaryStatus.tone,
  children: primaryStatusLabel,
};

const undoStatusLabel = undoStatus
  ? t(`historyStatus.${undoStatus.key}`, {
      defaultValue: undoStatus.key,
    })
  : null;

const undoStatusDetail = undoStatus
  ? t(`historyStatusDetail.${undoStatus.key}`, {
      defaultValue: "",
    })
  : "";

const undoBadge = undoStatus
  ? { tone: undoStatus.tone, children: undoStatusLabel }
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
  const undoBuckets = historyItem?.supportStatus?.undoSummaryBuckets || null;
  const editErrors = normalizeErrors(
    historyItem?.supportStatus?.errors || historyItem?.error,
  );
  const queuedForRetry =
    historyItem?.supportStatus?.queuedForRetry === true ||
    editErrors.some((entry) => entry?.retryable === true);
  const failureRows = editErrors.map((entry, index) => [
    <Text key={`failure-product-${index}`}>
      {getFailureProductLabel(entry)}
    </Text>,
    <Text key={`failure-error-${index}`} tone="subdued">
      {getFailureMessage(entry)}
    </Text>,
  ]);
  const targetCountForEstimate = Number(
    historyItem?.supportStatus?.targetSnapshotCount ||
      historyItem?.targetSnapshotCount ||
      historyItem?.totalItems ||
      mainProgress.total ||
      0,
  );
  const estimatedDurationMs = getEstimatedBulkEditMs(targetCountForEstimate);
  const hasDuration = Number(historyItem?.durationMs) > 0;
  const completionSpeedText =
    hasDuration && ["completed", "partial"].includes(primaryStatus.key)
      ? t("bulkEditCompletedSpeed", {
          duration: formatDuration(historyItem.durationMs),
          qualifier:
            estimatedDurationMs > 0 && historyItem.durationMs < estimatedDurationMs
              ? t("bulkEditFasterThanExpected", {
                  defaultValue: "faster than expected",
                })
              : t("bulkEditWithinExpectedTime", {
                  defaultValue: "within expected time",
                }),
          defaultValue: `Completed in ${formatDuration(
            historyItem.durationMs,
          )} (${
            estimatedDurationMs > 0 && historyItem.durationMs < estimatedDurationMs
              ? "faster than expected"
              : "within expected time"
          })`,
        })
      : "";
  const canDownload = primaryStatus.key === "completed" && flattenedRows.length > 0;

  return (
    <Page
      fullWidth
      title={title}
      backAction={{ content: t("History"), onAction: handleBack }}
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
        ...(undoRequestId
          ? [
              {
                content: t("downloadUndoConflicts", {
                  defaultValue: "Download undo conflicts CSV",
                }),
                onAction: handleDownloadUndoConflicts,
                loading: downloadUndoConflictsLoading,
              },
            ]
          : []),
        ...(isScheduledEdit
          ? [
              {
                content: t("cancelScheduledEdit", { defaultValue: "Cancel scheduled edit" }),
                onAction: handleCancelScheduledEdit,
                loading: cancelScheduledLoading,
                disabled: !canCancelScheduled || cancelScheduledLoading,
              },
            ]
          : []),
      ]}
    >
      <Layout>
        {isScheduledEdit ? (
          <Layout.Section>
            <Banner tone={scheduledState === "FAILED" ? "critical" : scheduledState === "CANCELLED" ? "warning" : "info"}>
              <BlockStack gap="100">
                <Text as="p" fontWeight="semibold">
                  {t("scheduledExecutionStateLabel", {
                    defaultValue: `Scheduled state: ${scheduledState}`,
                  })}
                </Text>
                <Text as="p" tone="subdued">
                  {t("scheduledExecutionStateHelp", {
                    defaultValue:
                      "States: PENDING, CLAIMED, EXECUTING, AWAITING_SHOPIFY, VERIFYING, COMPLETED, FAILED, CANCELLED.",
                  })}
                </Text>
              </BlockStack>
            </Banner>
          </Layout.Section>
        ) : null}
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

                {isActiveStatus(primaryStatus) ? (
                  <Text tone="subdued" variant="bodySm">
                    {t("bulkEditApplyingChanges", {
                      percent: Number(mainProgress.percent || 0),
                      defaultValue: `Applying changes... ${Number(
                        mainProgress.percent || 0,
                      )}%`,
                    })}
                  </Text>
                ) : null}

                <InlineStack align="space-between">
                  <Text tone="subdued">
                    {mainProgress.label ||
                      t("bulkEditProcessedCount", {
                        current: formatCount(mainProgress.current, i18n.language),
                        total: formatCount(
                          mainProgress.total || mainProgress.current,
                          i18n.language,
                        ),
                        defaultValue: `${formatCount(
                          mainProgress.current,
                          i18n.language,
                        )} / ${formatCount(
                          mainProgress.total || mainProgress.current,
                          i18n.language,
                        )} processed`,
                      })}
                  </Text>

                  {completionSpeedText ? (
                    <Text tone="subdued">{completionSpeedText}</Text>
                  ) : null}
                </InlineStack>

               {primaryStatusDetail ? (
  <Text tone="subdued" variant="bodySm">
    {primaryStatusDetail}
  </Text>
) : null}

                {historyItem?.supportStatus?.failureStage ? (
                  <Text tone="subdued" variant="bodySm">
                    {t("failureStage")}: {historyItem.supportStatus.failureStage}
                  </Text>
                ) : null}

                {queuedForRetry ? (
                  <Banner tone="info">
                    <BlockStack gap="100">
                      <Text as="p" fontWeight="semibold">
                        {t("offlineSafeQueuedForRetry", {
                          defaultValue: "Queued for retry",
                        })}
                      </Text>
                      <Text as="p" tone="subdued">
                        {t("offlineSafeAutoComplete", {
                          defaultValue:
                            "Will auto-complete when Shopify recovers.",
                        })}
                      </Text>
                    </BlockStack>
                  </Banner>
                ) : null}

                {editErrors.length > 0 ? (
                  <Banner tone={primaryStatus.key === "partial" ? "warning" : "critical"}>
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text>
                          {t("bulkEditFailuresCount", {
                            count: formatCount(editErrors.length, i18n.language),
                            defaultValue: `${formatCount(
                              editErrors.length,
                              i18n.language,
                            )} products failed`,
                          })}
                        </Text>
                        <Button
                          variant="plain"
                          onClick={() => {
                            setShowFailureInspector(true);
                            failuresSectionRef.current?.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                          }}
                        >
                          {t("viewFailures", {
                            defaultValue: "View failures",
                          })}
                        </Button>
                      </InlineStack>
                      {editErrors.slice(0, 3).map((entry, index) => (
                        <Text key={index} tone="subdued" variant="bodySm">
                          - {getFailureMessage(entry)}
                        </Text>
                      ))}
                    </BlockStack>
                  </Banner>
                ) : null}
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>

        {editErrors.length > 0 ? (
          <Layout.Section>
            <div ref={failuresSectionRef} />
            <Card>
              <Box padding="400">
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <Text variant="headingMd">
                        {t("partialFailureInspectorTitle", {
                          defaultValue: "Partial failure inspector",
                        })}
                      </Text>
                      <Text tone="subdued" variant="bodySm">
                        {t("partialFailureInspectorCount", {
                          count: formatCount(editErrors.length, i18n.language),
                          defaultValue: `${formatCount(
                            editErrors.length,
                            i18n.language,
                          )} products failed`,
                        })}
                      </Text>
                    </BlockStack>
                    <InlineStack gap="200">
                      <Button
                        onClick={() =>
                          setShowFailureInspector((current) => !current)
                        }
                      >
                        {showFailureInspector
                          ? t("hideFailures", {
                              defaultValue: "Hide failures",
                            })
                          : t("viewFailures", {
                              defaultValue: "View failures",
                            })}
                      </Button>
                      <Button disabled>
                        {t("retryFailedOnly", {
                          defaultValue: "Retry failed only",
                        })}
                      </Button>
                    </InlineStack>
                  </InlineStack>

                  {showFailureInspector ? (
                    <DataTable
                      columnContentTypes={["text", "text"]}
                      headings={[
                        t("table.product"),
                        t("failureErrorColumn", {
                          defaultValue: "Error",
                        }),
                      ]}
                      rows={failureRows}
                    />
                  ) : null}

                  <Text tone="subdued" variant="bodySm">
                    {t("retryFailedOnlyUnavailable", {
                      defaultValue:
                        "Retry failed only will activate when Shopify returns product-level failure records for this operation.",
                    })}
                  </Text>
                </BlockStack>
              </Box>
            </Card>
          </Layout.Section>
        ) : null}

        {undoStatus ? (
          <Layout.Section>
            <Card>
              <Box padding="400">
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <InlineStack gap="200">
                      <Icon source={getStatusIcon(undoStatus.key)} />
                      <Text variant="headingMd">{t("UndoProgress")}</Text>
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
                        {t("Duration")}: {formatDuration(historyItem.undo.durationMs)}
                      </Text>
                    ) : null}
                  </InlineStack>

                  {undoStatusDetail ? (
  <Text tone="subdued" variant="bodySm">
    {undoStatusDetail}
  </Text>
) : null}

                  {undoErrors.length > 0 ? (
                    <Banner tone={undoStatus.key === "undo_partial" ? "warning" : "critical"}>
                      <BlockStack gap="200">
                        <Text>
                          {undoStatus.key === "undo_partial"
                            ? t("undoFinishedWithIssues")
                            : t("undoEncounteredErrors")}
                        </Text>
                        {undoErrors.slice(0, 3).map((entry, index) => (
                          <Text key={index} tone="subdued" variant="bodySm">
                            - {entry?.message || entry?.code || "Unknown error"}
                          </Text>
                        ))}
                      </BlockStack>
                    </Banner>
                  ) : null}

                  {undoBuckets ? (
                    <Banner tone="info">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm">
                          {t("undoSummaryStatus", {
                            defaultValue: "Undo request status: {{status}}",
                            status: undoBuckets.undoOperationStatus || "UNKNOWN",
                          })}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {t("undoSummaryBuckets", {
                            defaultValue:
                              "Restored: {{restored}} | Failed: {{failed}} | Skipped: {{skipped}} | Conflict: {{conflict}} | Pending: {{pending}} | Dispatched: {{dispatched}}",
                            restored: Number(undoBuckets.restored || 0).toLocaleString(),
                            failed: Number(undoBuckets.failed || 0).toLocaleString(),
                            skipped: Number(undoBuckets.skipped || 0).toLocaleString(),
                            conflict: Number(undoBuckets.conflict || 0).toLocaleString(),
                            pending: Number(undoBuckets.pending || 0).toLocaleString(),
                            dispatched: Number(undoBuckets.dispatched || 0).toLocaleString(),
                          })}
                        </Text>
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
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd">
                    {t("ExecutionTimeline", {
                      defaultValue: "Execution timeline",
                    })}
                  </Text>
                  <Badge tone={primaryStatus.tone}>
                    {primaryStatusLabel}
                  </Badge>
                </InlineStack>

                <BlockStack gap="300">
                  {timelineRows.map((step, index) => (
                    <InlineStack
                      key={step.key}
                      gap="300"
                      wrap={false}
                      blockAlign="start"
                    >
                      <Box minWidth="28px">
                        <Icon source={step.icon} tone={step.tone} />
                      </Box>
                      <BlockStack gap="050">
                        <InlineStack gap="200" blockAlign="center">
                          <Text
                            as="p"
                            variant="bodyMd"
                            fontWeight={step.pending ? "regular" : "semibold"}
                            tone={step.pending ? "subdued" : undefined}
                          >
                            {step.title}
                          </Text>
                          {step.action ? (
                            <Button
                              variant="plain"
                              onClick={step.action.onAction}
                            >
                              {step.action.content}
                            </Button>
                          ) : null}
                        </InlineStack>
                        {index < timelineRows.length - 1 ? (
                          <Box
                            borderInlineStartWidth="025"
                            borderColor="border"
                            minHeight="16px"
                          />
                        ) : null}
                      </BlockStack>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <div ref={changesSectionRef} />
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
                  headings={[t("table.product"), t("table.field"), t("table.change")]}
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
