import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  DataTable,
  Badge,
  Button,
  InlineStack,
  BlockStack,
  Text,
  Box,
  EmptyState,
  SkeletonBodyText,
  SkeletonDisplayText,
  Card,
  Divider,
} from "@shopify/polaris";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import AlertUndo from "../../products/edit/components/AlertUndo";
import useProductSyncStatus from "../../../hooks/useProductSyncStatus";

function getPrimaryStatusSummary(item) {
  if (item?.primaryStatus) {
    return item.primaryStatus;
  }

  const status = String(item?.status || "pending").toLowerCase();

  switch (status) {
    case "completed":
      return {
        key: "completed",
        tone: "success",
        isTerminal: true,
      };
    case "failed":
      return {
        key: "failed",
        tone: "critical",
        isTerminal: true,
      };
    case "finalizing":
      return {
        key: "finalizing",
        tone: "info",
        isTerminal: false,
      };
    case "processing":
      return {
        key: "processing",
        tone: "info",
        isTerminal: false,
      };
    default:
      return {
        key: "pending",
        tone: "attention",
        isTerminal: false,
      };
  }
}

function getUndoStatusSummary(item) {
  if (item?.undoStatusSummary) {
    return item.undoStatusSummary;
  }

  const undoStatus = String(item?.undo?.status || "").toLowerCase();

  if (!undoStatus || undoStatus === "idle") {
    return null;
  }

  switch (undoStatus) {
    case "completed":
      return {
        key: "undo_completed",
        tone: "success",
        isTerminal: true,
      };
    case "failed":
      return {
        key: "undo_failed",
        tone: "critical",
        isTerminal: true,
      };
    default:
      return {
        key: "undo_processing",
        tone: "attention",
        isTerminal: false,
      };
  }
}

function isActiveStatus(summary) {
  return Boolean(summary) && summary.isTerminal !== true;
}

function getItemViewModel(item) {
  const primaryStatus = getPrimaryStatusSummary(item);
  const undoStatus = getUndoStatusSummary(item);

  const isProcessing =
    isActiveStatus(primaryStatus) || isActiveStatus(undoStatus);

  const progressLabel =
    item?.progressSummary?.label ||
    `${item?.processedCount || 0} / ${item?.totalItems || item?.processedCount || 0}`;

  const timeValue =
    isActiveStatus(undoStatus) && item?.undo?.startedAt
      ? item.undo.startedAt
      : undoStatus?.key === "undo_completed" && item?.undo?.completedAt
        ? item.undo.completedAt
        : item?.completedAt || item?.updatedAt || item?.editTime;

  return {
    primaryStatus,
    undoStatus,
    isProcessing,
    progressLabel,
    timeValue,
  };
}

const HistoryTable = memo(function HistoryTable({
  histories,
  isLoading,
  isLoadingMore,
  hasMore,
  onLoadMore,
  emptyStateMessage = "No history items found.",
}) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { isSyncInProgress } = useProductSyncStatus();

  const [showUndoModal, setShowUndoModal] = useState(false);
  const [undoLoading, setUndoLoading] = useState(false);
  const [undoHistoryItem, setUndoHistoryItem] = useState(null);
  const [localHistories, setLocalHistories] = useState(() => histories || []);

  useEffect(() => {
    setLocalHistories(histories || []);
  }, [histories]);

  const getStatusLabel = useCallback(
    (statusKey) => t(`historyStatus.${statusKey}`, { defaultValue: statusKey }),
    [t],
  );

  const getStatusDetail = useCallback(
    (status) => {
      if (!status) return null;

      if (status.detailKey) {
        return t(status.detailKey, {
          defaultValue: status.detail || "",
        });
      }

      return status.detail || null;
    },
    [t],
  );

  const handleCloseUndo = useCallback(() => {
    setShowUndoModal(false);
    setUndoHistoryItem(null);
  }, []);

  const handleUndo = useCallback((history) => {
    setUndoHistoryItem(history);
    setShowUndoModal(true);
  }, []);

  const canUndo = useCallback((item) => {
    const primaryStatus = getPrimaryStatusSummary(item);
    const undoStatus = item?.undo?.status ?? item?.undoStatusSummary?.key ?? "idle";
    const isAllowed = item?.undo == null ? true : item.undo.allowed === true;

    return (
      primaryStatus.key === "completed" &&
      isAllowed &&
      ["idle", "failed", "undo_failed"].includes(String(undoStatus))
    );
  }, []);

  const renderStatusBadge = useCallback(
    (item) => {
      const { primaryStatus, undoStatus } = getItemViewModel(item);

      return (
        <InlineStack gap="150" wrap>
          <Badge tone={primaryStatus.tone}>
            {getStatusLabel(primaryStatus.key)}
          </Badge>

          {undoStatus ? (
            <Badge tone={undoStatus.tone}>
              {getStatusLabel(undoStatus.key)}
            </Badge>
          ) : null}
        </InlineStack>
      );
    },
    [getStatusLabel],
  );

  const handleUndoEditHistory = useCallback(async () => {
    if (!undoHistoryItem?.id) return;

    setUndoLoading(true);

    try {
      const response = await fetch(`/api/products/undo-edit/${undoHistoryItem.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        return;
      }

      setLocalHistories((prev) =>
        prev.map((history) =>
          history.id === undoHistoryItem.id
            ? {
                ...history,
                undo: {
                  ...history.undo,
                  status: "processing",
                  state: "queued",
                  startedAt: new Date().toISOString(),
                },
                undoStatusSummary: {
                  key: "undo_queued",
                  tone: "attention",
                  isTerminal: false,
                },
              }
            : history,
        ),
      );

      setShowUndoModal(false);
      setUndoHistoryItem(null);
    } finally {
      setUndoLoading(false);
    }
  }, [undoHistoryItem]);

  const activeHistoryIds = useMemo(() => {
    return (localHistories || [])
      .filter((history) => {
        const { primaryStatus, undoStatus } = getItemViewModel(history);
        return isActiveStatus(primaryStatus) || isActiveStatus(undoStatus);
      })
      .map((history) => history.id)
      .filter(Boolean);
  }, [localHistories]);

  const fetchHistoryDetails = useCallback(async () => {
    if (activeHistoryIds.length === 0) {
      return;
    }

    try {
      const updates = await Promise.all(
        activeHistoryIds.map((id) =>
          fetch(
            `/api/history/get-edit-history-details/${id}?lang=${encodeURIComponent(i18n.language)}`,
          )
            .then((response) => (response.ok ? response.json() : null))
            .then((json) => json?.data || null)
            .catch(() => null),
        ),
      );

      const updateMap = new Map(
        updates.filter(Boolean).map((entry) => [entry.id, entry]),
      );

      if (updateMap.size === 0) {
        return;
      }

      setLocalHistories((prev) =>
        prev.map((history) => {
          const updated = updateMap.get(history.id);
          return updated ? { ...history, ...updated } : history;
        }),
      );
    } catch {
      // silent polling failure
    }
  }, [activeHistoryIds, i18n.language]);

  useEffect(() => {
    if (activeHistoryIds.length === 0) {
      return undefined;
    }

    const interval = setInterval(() => {
      fetchHistoryDetails();
    }, 3000);

    return () => clearInterval(interval);
  }, [activeHistoryIds, fetchHistoryDetails]);

  const summary = useMemo(() => {
    const items = localHistories || [];

    const total = items.length;
    const processing = items.filter((item) => {
      const { primaryStatus, undoStatus } = getItemViewModel(item);
      return isActiveStatus(primaryStatus) || isActiveStatus(undoStatus);
    }).length;

    const completed = items.filter(
      (item) => getPrimaryStatusSummary(item).key === "completed",
    ).length;

    const failed = items.filter(
      (item) => getPrimaryStatusSummary(item).key === "failed",
    ).length;

    return {
      total,
      processing,
      completed,
      failed,
    };
  }, [localHistories]);

  const rows = useMemo(() => {
    return (localHistories || []).map((item) => {
      const { id, title, shop } = item;
      const user = shop?.split(".")[0];

      const {
        primaryStatus,
        undoStatus,
        isProcessing,
        progressLabel,
        timeValue,
      } = getItemViewModel(item);

      const isUndoable = canUndo(item);
      const undoDisabled = !isUndoable || isProcessing || isSyncInProgress;
      const primaryDetail = getStatusDetail(primaryStatus);

      return [
        <Box key={`title-${id}`} maxWidth="320px">
          <BlockStack gap="050">
         <Text variant="bodyMd" fontWeight="medium" truncate as="span">
  {typeof title === "string"
    ? title
    : Array.isArray(title)
      ? title
          .map((rule) =>
            `${t(`fieldLabels.${rule.field}`)} ${t(rule.operation)} ${rule.value}`
          )
          .join(" + ")
      : "-"}
</Text>
            <Text variant="bodySm" tone="subdued" as="span">
              {user || "-"}
            </Text>
          </BlockStack>
        </Box>,

        renderStatusBadge(item),

        <BlockStack key={`processed-${id}`} gap="050">
          <Text variant="bodyMd" as="span">
            {progressLabel}
          </Text>
          {primaryDetail ? (
            <Text variant="bodySm" tone="subdued" as="span">
              {primaryDetail}
            </Text>
          ) : null}
        </BlockStack>,

        <Text key={`updated-${id}`} as="span" variant="bodySm">
          {timeValue ? new Date(timeValue).toLocaleString() : "-"}
        </Text>,

        <InlineStack key={`actions-${id}`} gap="200" wrap={false}>
          <Button size="slim" onClick={() => navigate(`/editDetails/${id}`)}>
            {t("historyViewButton")}
          </Button>

          <Button
            size="slim"
            tone={isUndoable ? "critical" : undefined}
            onClick={() => {
              if (isUndoable) {
                handleUndo(item);
              }
            }}
            disabled={undoDisabled}
          >
            {t("historyUndoButton")}
          </Button>
        </InlineStack>,
      ];
    });
  }, [
    localHistories,
    canUndo,
    getStatusDetail,
    handleUndo,
    isSyncInProgress,
    navigate,
    renderStatusBadge,
    t,
  ]);

  if (isLoading) {
    return (
      <Card padding="0">
        <Box padding="500">
          <BlockStack gap="400">
            <BlockStack gap="200">
              <SkeletonDisplayText size="small" />
              <SkeletonBodyText lines={2} />
            </BlockStack>

            <Divider />

            <BlockStack gap="300">
              <SkeletonBodyText lines={6} />
            </BlockStack>
          </BlockStack>
        </Box>
      </Card>
    );
  }

  if (!localHistories || localHistories.length === 0) {
    return (
      <Card>
        <Box padding="1200">
          <EmptyState heading={t("historyEmptyStateTitle")}>
            <p>{emptyStateMessage}</p>
          </EmptyState>
        </Box>
      </Card>
    );
  }

  return (
    <Card padding="0">
      <Box padding="500">
        <BlockStack gap="500">
          <InlineStack align="space-between" blockAlign="start" wrap gap="300">
            <BlockStack gap="100">
              <Box paddingInlineStart="500">
                <BlockStack gap="100">
                  <Text as="h3" variant="headingMd">
                    {t("historyEditActivityTitle")}
                  </Text>

                  <Text tone="subdued" variant="bodySm">
                    {t("historyEditActivityText")}
                  </Text>

                  {isSyncInProgress ? (
                    <Text tone="subdued" variant="bodySm">
                      {t("historyUndoDisabledSync")}
                    </Text>
                  ) : null}
                </BlockStack>
              </Box>
            </BlockStack>

            <InlineStack gap="200" wrap>
              <Badge>
                {summary.total} {t("historySummaryTotal")}
              </Badge>
              <Badge tone="info">
                {summary.processing} {t("historySummaryActive")}
              </Badge>
              <Badge tone="success">
                {summary.completed} {t("historySummaryCompleted")}
              </Badge>
              <Badge tone="critical">
                {summary.failed} {t("historySummaryFailed")}
              </Badge>
            </InlineStack>
          </InlineStack>

          <InlineStack align="space-between" blockAlign="center" wrap gap="300">
            <Box
              background="bg-surface-secondary"
              borderRadius="300"
              padding="300"
              paddingInlineStart="800"
            >
              <Text tone="subdued" variant="bodySm" as="p">
                {t("historyLiveStatusHint")}
              </Text>
            </Box>

            <Text tone="subdued" variant="bodySm">
              {localHistories.length} {t("historyItemsCount")}
            </Text>
          </InlineStack>
        </BlockStack>
      </Box>

      <Divider />

      <Box overflowX="auto" paddingInlineStart="800">
        <DataTable
          columnContentTypes={["text", "text", "text", "text", "text"]}
          headings={[
            t("historyColumnTitle"),
            t("historyColumnStatus"),
            t("historyColumnProcessed"),
            t("historyColumnUpdated"),
            t("historyColumnActions"),
          ]}
          rows={rows}
        />
      </Box>

      {hasMore ? (
        <>
          <Divider />
          <Box padding="400">
            <InlineStack align="space-between" blockAlign="center" wrap gap="300">
              <Text tone="subdued" variant="bodySm">
                {t("historyLoadMoreHint")}
              </Text>

              <Button loading={isLoadingMore} onClick={onLoadMore}>
                {t("historyLoadMoreButton")}
              </Button>
            </InlineStack>
          </Box>
        </>
      ) : null}

      <AlertUndo
        show={showUndoModal}
        handleClose={handleCloseUndo}
        undoEditHistory={handleUndoEditHistory}
        loading={undoLoading}
      />
    </Card>
  );
});

HistoryTable.displayName = "HistoryTable";

export default HistoryTable;