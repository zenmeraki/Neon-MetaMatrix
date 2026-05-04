import React, { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Modal,
  FormLayout,
  Checkbox,
  TextField,
  Banner,
  BlockStack,
  InlineStack,
  Text,
  Box,
  Badge,
  Divider,
  Frame,
  Toast,
} from "@shopify/polaris";
import { t } from "i18next";

function ScheduleEdit({
  onHide,
  count,
  editedField,
  editedBy,
  show,
  value,
  searchKey,
  replaceText,
  location,
  filters,
  targetSnapshotId,
  supportValue,
}) {
  const navigate = useNavigate();

  const [startEditChecked, setStartEditChecked] = useState(false);
  const [undoStartEditChecked, setUndoStartEditChecked] = useState(false);
  const [startEditDate, setStartEditDate] = useState("");
  const [startEditTime, setStartEditTime] = useState("");
  const [undoStartEditDate, setUndoStartEditDate] = useState("");
  const [undoStartEditTime, setUndoStartEditTime] = useState("");
  const [upgradeWarning, setUpgradeWarning] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [toastState, setToastState] = useState({
    active: false,
    message: "",
    error: false,
  });

  const isFormValid = startEditChecked && startEditDate && startEditTime;

  const scheduledPreview = useMemo(() => {
    if (!startEditChecked || !startEditDate || !startEditTime) return null;
    const scheduledDate = new Date(`${startEditDate}T${startEditTime}:00`);
    const dateLabel = scheduledDate.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const timeLabel = scheduledDate.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });

    return { dateLabel, timeLabel };
  }, [startEditChecked, startEditDate, startEditTime]);

  const handleDateChange = useCallback((val, type) => {
    if (type === "start") setStartEditDate(val);
    else setUndoStartEditDate(val);
  }, []);

  const handleTimeChange = useCallback((val, type) => {
    if (type === "start") setStartEditTime(val);
    else setUndoStartEditTime(val);
  }, []);

  const handleCheckboxChange = useCallback((val, type) => {
    if (type === "start") {
      setStartEditChecked(val);
      if (!val) { setStartEditDate(""); setStartEditTime(""); }
    } else {
      setUndoStartEditChecked(val);
      if (!val) { setUndoStartEditDate(""); setUndoStartEditTime(""); }
    }
  }, []);

  const resetForm = useCallback(() => {
    setStartEditChecked(false);
    setUndoStartEditChecked(false);
    setStartEditDate("");
    setStartEditTime("");
    setUndoStartEditDate("");
    setUndoStartEditTime("");
    setError(null);
    setUpgradeWarning(null);
  }, []);

  const handleScheduleEdit = useCallback(async () => {
    if (!isFormValid) return;
    setSubmitting(true);
    setError(null);

    try {
      const scheduledAt = new Date(`${startEditDate}T${startEditTime}:00`).toISOString();
      const scheduledUndoAt =
        undoStartEditChecked && undoStartEditDate && undoStartEditTime
          ? new Date(`${undoStartEditDate}T${undoStartEditTime}:00`).toISOString()
          : null;

      if (
        scheduledUndoAt &&
        new Date(scheduledUndoAt).getTime() <= new Date(scheduledAt).getTime()
      ) {
        throw new Error("Undo time must be later than the scheduled edit time");
      }

      const payload = {
        editedField,
        editedBy,
        scheduledAt,
        scheduledUndoAt,
        value,
        searchKey,
        replaceText,
        locationId: location,
        filterParams: targetSnapshotId ? [] : filters,
        targetSnapshotId: targetSnapshotId || undefined,
        supportValue,
      };

      const response = await fetch("/api/products/schedule-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMessage = data?.message || data?.error || t("schedule_fail");
        if (data.code === "PRODUCT_LIMIT_EXCEEDED" || data.code === "UPGRADE_REQUIRED") {
          setUpgradeWarning(errorMessage);
          return;
        }
        throw new Error(errorMessage);
      }

      setToastState({ active: true, message: t("schedule_msg"), error: false });
      setTimeout(() => { resetForm(); onHide(); navigate("/history"); }, 1000);
    } catch (err) {
      setError(err.message || t("try_again"));
      setToastState({ active: true, message: err.message || t("try_again"), error: true });
    } finally {
      setSubmitting(false);
    }
  }, [
    isFormValid, startEditDate, startEditTime, undoStartEditChecked,
    undoStartEditDate, undoStartEditTime, editedField, editedBy, value,
    searchKey, replaceText, location, filters, targetSnapshotId, supportValue,
    resetForm, onHide, navigate,
  ]);

  const handleClose = useCallback(() => { resetForm(); onHide(); }, [resetForm, onHide]);

  const toastMarkup = toastState.active ? (
    <Toast
      content={toastState.message}
      error={toastState.error}
      onDismiss={() => setToastState({ active: false, message: "", error: false })}
    />
  ) : null;

  return (
    <Frame>
      <Modal
        open={show}
        onClose={handleClose}
        title={t("scheduleEditLabel", { defaultValue: "Schedule this edit" })}
        primaryAction={{
          content: t("schedule", { defaultValue: "Schedule edit" }),
          onAction: handleScheduleEdit,
          loading: submitting,
          disabled: !isFormValid || submitting,
        }}
        secondaryActions={[
          {
            content: t("cancel", { defaultValue: "Cancel" }),
            onAction: handleClose,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="500">
            {/* Banners */}
            {upgradeWarning && (
              <Banner
                tone="warning"
                title={t("upgradeRequired", { defaultValue: "Upgrade required" })}
                onDismiss={() => setUpgradeWarning(null)}
                action={{ content: t("upgradePlan", { defaultValue: "Upgrade plan" }), onAction: () => navigate("/pricing") }}
              >
                <Text as="p">{upgradeWarning}</Text>
              </Banner>
            )}
            {error && (
              <Banner tone="critical" onDismiss={() => setError(null)}>
                <Text as="p">{error}</Text>
              </Banner>
            )}

            {/* Schedule start */}
            <BlockStack gap="300">
              <Checkbox
                label={
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {t("startEditTime", { defaultValue: "Schedule a start time" })}
                  </Text>
                }
                helpText={t("startEditHelpText", { defaultValue: "The edit will run automatically at the selected date and time." })}
                checked={startEditChecked}
                onChange={(checked) => handleCheckboxChange(checked, "start")}
              />
              {startEditChecked && (
                <Box paddingInlineStart="600">
                  <FormLayout>
                    <FormLayout.Group condensed>
                      <TextField
                        label={t("date", { defaultValue: "Date" })}
                        type="date"
                        value={startEditDate}
                        onChange={(val) => handleDateChange(val, "start")}
                        helpText={t("selectDateRunEdit", { defaultValue: "Select the date to run this edit" })}
                        min={new Date().toISOString().split("T")[0]}
                      />
                      <TextField
                        label={t("time", { defaultValue: "Time" })}
                        type="time"
                        value={startEditTime}
                        onChange={(val) => handleTimeChange(val, "start")}
                        helpText={t("selectTimeRunEdit", { defaultValue: "Select the time to run this edit" })}
                      />
                    </FormLayout.Group>
                  </FormLayout>
                </Box>
              )}
            </BlockStack>

            {startEditChecked && <Divider />}

            {/* Schedule undo */}
            <BlockStack gap="300">
              <Checkbox
                label={
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {t("scheduleUndo", { defaultValue: "Schedule automatic undo" })}
                  </Text>
                }
                helpText={t("revertChangesNote", { defaultValue: "Automatically revert all changes at a later time." })}
                checked={undoStartEditChecked}
                onChange={(checked) => handleCheckboxChange(checked, "undo")}
                disabled={!startEditChecked}
              />
              {undoStartEditChecked && (
                <Box paddingInlineStart="600">
                  <FormLayout>
                    <FormLayout.Group condensed>
                      <TextField
                        label={t("undoDate", { defaultValue: "Undo date" })}
                        type="date"
                        value={undoStartEditDate}
                        onChange={(val) => handleDateChange(val, "undo")}
                        helpText={t("selectDateUndoEdit", { defaultValue: "Must be after the scheduled start date" })}
                        min={startEditDate || new Date().toISOString().split("T")[0]}
                      />
                      <TextField
                        label={t("undoTime", { defaultValue: "Undo time" })}
                        type="time"
                        value={undoStartEditTime}
                        onChange={(val) => handleTimeChange(val, "undo")}
                        helpText={t("selectTimeUndoEdit", { defaultValue: "Must be after the scheduled start time" })}
                      />
                    </FormLayout.Group>
                  </FormLayout>
                </Box>
              )}
            </BlockStack>
          </BlockStack>
        </Modal.Section>

        {/* Schedule preview — only shown when form is valid */}
        {scheduledPreview && (
          <Modal.Section>
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                {t("scheduledEditPreviewTitle", { defaultValue: "Schedule summary" })}
              </Text>
              <Box
                background="bg-surface-secondary"
                padding="400"
                borderRadius="200"
              >
                <BlockStack gap="200">
                  <InlineStack gap="300" blockAlign="center" wrap={false}>
                    <Box minWidth="120px">
                      <Text as="span" variant="bodySm" tone="subdued">
                        {t("scheduledRunDate", { defaultValue: "Runs on" })}
                      </Text>
                    </Box>
                    <InlineStack gap="150" blockAlign="center">
                      <Badge tone="info">{scheduledPreview.dateLabel}</Badge>
                      <Text as="span" variant="bodySm" fontWeight="medium">
                        {t("at", { defaultValue: "at" })} {scheduledPreview.timeLabel}
                      </Text>
                    </InlineStack>
                  </InlineStack>

                  <InlineStack gap="300" blockAlign="center" wrap={false}>
                    <Box minWidth="120px">
                      <Text as="span" variant="bodySm" tone="subdued">
                        {t("scheduledProducts", { defaultValue: "Products" })}
                      </Text>
                    </Box>
                    <Badge tone="attention">
                      {count?.toLocaleString() || 0} {t("products", { defaultValue: "products" })}
                    </Badge>
                  </InlineStack>

                  <InlineStack gap="300" blockAlign="center" wrap={false}>
                    <Box minWidth="120px">
                      <Text as="span" variant="bodySm" tone="subdued">
                        {t("scheduledUndo", { defaultValue: "Auto-undo" })}
                      </Text>
                    </Box>
                    <Badge tone={undoStartEditChecked ? "success" : "enabled"}>
                      {undoStartEditChecked
                        ? t("enabled", { defaultValue: "Enabled" })
                        : t("disabled", { defaultValue: "Disabled" })}
                    </Badge>
                  </InlineStack>
                </BlockStack>
              </Box>
            </BlockStack>
          </Modal.Section>
        )}
      </Modal>
      {toastMarkup}
    </Frame>
  );
}

export default React.memo(ScheduleEdit);