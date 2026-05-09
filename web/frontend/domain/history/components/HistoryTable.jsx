import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
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
  IndexTable,
} from "@shopify/polaris";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { historyService } from "../services/historyService";
import PipelineTelemetryCard from "../../../components/PipelineTelemetryCard";

import AlertUndo from "../../products/edit/components/AlertUndo";
import useProductSyncStatus from "../../../hooks/useProductSyncStatus";
import { useAuthenticatedFetch } from "../../../hooks/useAuthenticatedFetch";

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
  const progressPercent = Number(item?.progressSummary?.percent ?? 0);
  const telemetry = item?.telemetry || null;

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
    progressPercent,
    telemetry,
    timeValue,
  };
}

function getDateGroupLabel(value, t) {
  if (!value) {
    return t("historyGroupUnknown", { defaultValue: "Unknown date" });
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return t("historyGroupUnknown", { defaultValue: "Unknown date" });
  }

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const normalize = (input) =>
    new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime();

  const normalizedDate = normalize(date);

  if (normalizedDate === normalize(today)) {
    return t("historyGroupToday", { defaultValue: "Today" });
  }

  if (normalizedDate === normalize(yesterday)) {
    return t("historyGroupYesterday", { defaultValue: "Yesterday" });
  }

  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
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
  const fetchWithAuth = useAuthenticatedFetch();
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
    if (undoLoading) return;
    setShowUndoModal(false);
    setUndoHistoryItem(null);
  }, [undoLoading]);

  const handleUndo = useCallback((history) => {
    if (history?.canUndo !== true) {
      return;
    }
    setUndoHistoryItem(history);
    setShowUndoModal(true);
  }, []);

  const canUndo = useCallback((item) => item?.canUndo === true, []);

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
    if (undoHistoryItem?.canUndo !== true) return;
    const executionId =
      undoHistoryItem?.undo?.executionIdentity ||
      undoHistoryItem?.executionIdentity ||
      undoHistoryItem?.operationId ||
      undoHistoryItem?.id;

    setUndoLoading(true);

    try {
      const response = await fetchWithAuth(`/api/products/undo-edit/${undoHistoryItem.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": `undo:${executionId}`,
        },
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
  }, [fetchWithAuth, undoHistoryItem]);

  const undoModalSummary = useMemo(() => {
    if (!undoHistoryItem) return null;
    return {
      canUndo: undoHistoryItem?.canUndo === true,
      undoBlockedReason: undoHistoryItem?.undoBlockedReason || null,
      targetCount: Number(
        undoHistoryItem?.targetSnapshotCount ||
          undoHistoryItem?.totalItems ||
          0,
      ),
      conflictCount:
        typeof undoHistoryItem?.conflictCount === "number"
          ? undoHistoryItem.conflictCount
          : null,
      executionId:
        undoHistoryItem?.undo?.executionIdentity ||
        undoHistoryItem?.executionIdentity ||
        undoHistoryItem?.operationId ||
        null,
      targetSnapshotId: undoHistoryItem?.targetSnapshotId || null,
      mirrorBatchId:
        undoHistoryItem?.mirrorBatchId ||
        undoHistoryItem?.targetMirrorBatchId ||
        null,
    };
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
          fetchWithAuth(
            `/api/history/get-edit-history-details/${id}?lang=${encodeURIComponent(i18n.language)}`,
          )
            .then((response) => (response.ok ? response.json() : null))
            .then((json) => json?.data || null)
            .catch(() => null),
        ),
      );

      const updateMap = new Map(
        updates
          .filter(Boolean)
          .map((entry) => [entry.operationId || entry.id, entry]),
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
  }, [activeHistoryIds, fetchWithAuth, i18n.language]);

  const fetchLiveProgress = useCallback(async () => {
    if (activeHistoryIds.length === 0) {
      return;
    }

    try {
      const updates = await Promise.all(
        activeHistoryIds.map((id) =>
          historyService.getLiveProgress(id).catch(() => null),
        ),
      );

      const updateMap = new Map(
        updates
          .filter((entry) => entry?.id)
          .map((entry) => [entry.id, entry]),
      );

      if (updateMap.size === 0) return;

      setLocalHistories((prev) =>
        prev.map((history) => {
          const update = updateMap.get(history.id);
          if (!update) return history;

          return {
            ...history,
            status: update.status || history.status,
            processedCount: update.processedCount ?? history.processedCount,
            totalItems: update.totalItems ?? history.totalItems,
            progressSummary: {
              ...(history.progressSummary || {}),
              percent: update.percent,
              processedCount: update.processedCount,
              totalItems: update.totalItems,
              isActive: update.isActive,
              status: update.status,
              label: update.label,
            },
            telemetry: {
              ...(history.telemetry || {}),
              ...(update.telemetry || {}),
            },
          };
        }),
      );
    } catch {
      // silent polling failure
    }
  }, [activeHistoryIds]);

  useEffect(() => {
    if (activeHistoryIds.length === 0) {
      return undefined;
    }

    const interval = setInterval(() => {
      fetchHistoryDetails();
      fetchLiveProgress();
    }, 3000);

    return () => clearInterval(interval);
  }, [activeHistoryIds, fetchHistoryDetails, fetchLiveProgress]);

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

  const activeTelemetry = useMemo(() => {
    const active = (localHistories || []).find((item) => {
      const { primaryStatus, undoStatus } = getItemViewModel(item);
      return (
        (isActiveStatus(primaryStatus) || isActiveStatus(undoStatus)) &&
        item?.telemetry
      );
    });
    return active?.telemetry || null;
  }, [localHistories]);

  const groupedRows = useMemo(() => {
    const groups = new Map();

    (localHistories || []).forEach((item, index) => {
      const { id, title, shop } = item;
      const user = shop?.split(".")[0];

      const {
        primaryStatus,
        undoStatus,
        isProcessing,
        progressLabel,
        progressPercent,
        telemetry,
        timeValue,
      } = getItemViewModel(item);

      const isUndoable = canUndo(item);
      const undoDisabled = !isUndoable || isProcessing || isSyncInProgress;
      const primaryDetail = getStatusDetail(primaryStatus);
      const undoBlockedReason = item?.undoBlockedReason || null;
      const groupLabel = getDateGroupLabel(timeValue, t);
      const groupRows = groups.get(groupLabel) || [];

      groupRows.push(
        <IndexTable.Row id={String(id)} key={String(id)} position={index}>
          <IndexTable.Cell>
            <Box maxWidth="320px">
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
            </Box>
          </IndexTable.Cell>

          <IndexTable.Cell>{renderStatusBadge(item)}</IndexTable.Cell>

          <IndexTable.Cell>
            <BlockStack gap="050">
              <InlineStack gap="150" blockAlign="center">
                <Text variant="bodyMd" as="span">
                  {progressLabel}
                </Text>
                <Badge tone={isProcessing ? "info" : "success"}>
                  {`${progressPercent}%`}
                </Badge>
              </InlineStack>
              {telemetry?.phase ? (
                <Text variant="bodySm" tone="subdued" as="span">
                  {telemetry.phase}
                </Text>
              ) : null}
              {telemetry ? (
                <Text variant="bodySm" tone="subdued" as="span">
                  {`ETA: ${telemetry.etaLabel || "-"} • ${telemetry.throughputPerSecond ?? "-"} upd/s • Failed: ${telemetry.failedItems ?? 0}`}
                </Text>
              ) : null}
              {telemetry?.confidence ? (
                <Text variant="bodySm" tone="subdued" as="span">
                  {`Execution Confidence: ${telemetry.confidence.score}%${
                    telemetry.confidence.reasons?.length
                      ? ` • ${telemetry.confidence.reasons.join(" • ")}`
                      : ""
                  }`}
                </Text>
              ) : null}
              {Array.isArray(telemetry?.activityStream) && telemetry.activityStream.length > 0 ? (
                <Text variant="bodySm" tone="subdued" as="span">
                  {telemetry.activityStream.slice(0, 3).map((entry) => `✓ ${entry.text}`).join(" • ")}
                </Text>
              ) : null}
              {telemetry ? (
                <InlineStack gap="150" wrap>
                  {telemetry.safeToCloseTab ? (
                    <Badge tone="success">SAFE TO CLOSE TAB</Badge>
                  ) : null}
                  {telemetry.undoSnapshot === "VERIFIED" ? (
                    <Badge tone="success">UNDO SNAPSHOT VERIFIED</Badge>
                  ) : null}
                  {telemetry.throttlingDetected ? (
                    <Badge tone="warning">SHOPIFY THROTTLING DETECTED</Badge>
                  ) : null}
                  {telemetry.autoRecoveryActive ? (
                    <Badge tone="info">AUTO-RECOVERY ACTIVE</Badge>
                  ) : null}
                </InlineStack>
              ) : null}
              {primaryDetail ? (
                <Text variant="bodySm" tone="subdued" as="span">
                  {primaryDetail}
                </Text>
              ) : null}
            </BlockStack>
          </IndexTable.Cell>

          <IndexTable.Cell>
            <Text as="span" variant="bodySm">
              {timeValue ? new Date(timeValue).toLocaleString() : "-"}
            </Text>
          </IndexTable.Cell>

          <IndexTable.Cell>
            <InlineStack gap="200" wrap={false}>
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
            </InlineStack>
            {!isUndoable && undoBlockedReason ? (
              <Text as="p" variant="bodySm" tone="subdued">
                {undoBlockedReason}
              </Text>
            ) : null}
          </IndexTable.Cell>
        </IndexTable.Row>,
      );

      groups.set(groupLabel, groupRows);
    });

    return Array.from(groups.entries()).map(([label, rows]) => ({
      label,
      rows,
    }));
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

          {activeTelemetry ? (
            <PipelineTelemetryCard
              telemetry={activeTelemetry}
              title="Live Pipeline Telemetry"
            />
          ) : null}
        </BlockStack>
      </Box>

      <Divider />

      <BlockStack gap="400">
        {groupedRows.map((group) => (
          <Box key={group.label} overflowX="auto" paddingInlineStart="800">
            <Box paddingBlockStart="400" paddingBlockEnd="200">
              <Text as="h4" variant="headingSm">
                {group.label}
              </Text>
            </Box>
            <IndexTable
              resourceName={{ singular: "history item", plural: "history items" }}
              itemCount={group.rows.length}
              selectable={false}
              headings={[
                { title: t("historyColumnTitle") },
                { title: t("historyColumnStatus") },
                { title: t("historyColumnProcessed") },
                { title: t("historyColumnUpdated") },
                { title: t("historyColumnActions") },
              ]}
            >
              {group.rows}
            </IndexTable>
          </Box>
        ))}
      </BlockStack>

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
        summary={undoModalSummary}
      />
    </Card>
  );
});

HistoryTable.displayName = "HistoryTable";

export default HistoryTable;
