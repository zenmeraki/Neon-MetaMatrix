import React, { useState, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Modal,
  FormLayout,
  Checkbox,
  TextField,
  Banner,
  BlockStack,
  Text,
  Box,
  Toast,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import { useAuthenticatedFetch } from "../../../../hooks/useAuthenticatedFetch";

function ScheduleEdit({
  onHide,
  count,
  editedField,
  editedBy,
  inputType,
  show,
  value,
  searchKey,
  replaceText,
  location,
  filters,
  targetSnapshotId,
  supportValue,
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fetchWithAuth = useAuthenticatedFetch();
  const submitLockRef = useRef(false);
  const browserTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    []
  );
  // State for form fields
  const [startEditChecked, setStartEditChecked] = useState(false);
  const [undoStartEditChecked, setUndoStartEditChecked] = useState(false);
  const [startEditDate, setStartEditDate] = useState("");
  const [startEditTime, setStartEditTime] = useState("");
  const [undoStartEditDate, setUndoStartEditDate] = useState("");
  const [undoStartEditTime, setUndoStartEditTime] = useState("");
  const [upgradeWarning, setUpgradeWarning] = useState(null);
  const [scheduleConfirmText, setScheduleConfirmText] = useState("");

  // State for UI
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [toastState, setToastState] = useState({
    active: false,
    message: "",
    error: false,
  });

  // Check if the form is valid
  const isFormValid = startEditChecked && startEditDate && startEditTime;
  const requiresTypedConfirmation =
    Number(count || 0) >= LARGE_SCHEDULE_THRESHOLD &&
    DESTRUCTIVE_FIELDS.has(String(editedField || ""));
  const typedConfirmValid =
    !requiresTypedConfirmation ||
    scheduleConfirmText.trim().toUpperCase() === SCHEDULE_CONFIRM_TEXT;
  const scheduledPreview = useMemo(() => {
    if (!startEditChecked || !startEditDate || !startEditTime) return null;

    const scheduledDate = DateTime.fromISO(`${startEditDate}T${startEditTime}`, {
      zone: browserTimezone,
    });
    if (!scheduledDate.isValid) return null;
    const nextRunLabel = scheduledDate.toLocaleString(DateTime.DATE_MED);
    const runTimeLabel = scheduledDate.toLocaleString(DateTime.TIME_SIMPLE);

    return {
      runLine: t("scheduledEditPreviewRunLine", {
        time: runTimeLabel,
        defaultValue: `This edit will run at ${runTimeLabel}`,
      }),
      matchesLine: t("scheduledEditPreviewMatchesLine", {
        count,
        defaultValue: `Current estimate only: ${count} products. Actual target set will be frozen at execution time.`,
      }),
      nextRunLine: t("scheduledEditPreviewNextRunLine", {
        date: nextRunLabel,
        defaultValue: `Next run: ${nextRunLabel}`,
      }),
      undoLine: t("scheduledEditPreviewUndoLine", {
        defaultValue:
          "Undo can be scheduled after execution completes successfully.",
      }),
    };
  }, [
    startEditChecked,
    startEditDate,
    startEditTime,
    undoStartEditChecked,
    count,
  ]);

  // Handle date input changes
  const handleDateChange = useCallback((value, type) => {
    if (type === "start") {
      setStartEditDate(value);
    } else {
      setUndoStartEditDate(value);
    }
  }, []);

  // Handle time input changes
  const handleTimeChange = useCallback((value, type) => {
    if (type === "start") {
      setStartEditTime(value);
    } else {
      setUndoStartEditTime(value);
    }
  }, []);

  // Handle checkbox changes
  const handleCheckboxChange = useCallback((value, type) => {
    if (type === "start") {
      setStartEditChecked(value);
      if (!value) {
        setStartEditDate("");
        setStartEditTime("");
      }
    } else {
      setUndoStartEditChecked(value);
      if (!value) {
        setUndoStartEditDate("");
        setUndoStartEditTime("");
      }
    }
  }, []);

  // Reset the form to its initial state
  const resetForm = useCallback(() => {
    setStartEditChecked(false);
    setUndoStartEditChecked(false);
    setStartEditDate("");
    setStartEditTime("");
    setUndoStartEditDate("");
    setUndoStartEditTime("");
    setScheduleConfirmText("");
    setError(null);
  }, []);

  // Handle schedule edit submission
  const handleScheduleEdit = useCallback(async () => {
    if (!isFormValid || !typedConfirmValid) return;
    if (submitLockRef.current) return;
    if (!targetSnapshotId) {
      setError(
        t("scheduledSnapshotRequired", {
          defaultValue: "Target snapshot is required for scheduled edits.",
        })
      );
      return;
    }

    submitLockRef.current = true;

    setSubmitting(true);
    setError(null);

    try {
      const scheduledLocal = DateTime.fromISO(
        `${startEditDate}T${startEditTime}`,
        { zone: browserTimezone }
      );
      if (!scheduledLocal.isValid) {
        throw new Error("Invalid scheduled start date/time");
      }
      const scheduledAt = scheduledLocal.toUTC().toISO();

      const payload = {
        source: "SCHEDULED",
        editedField,
        editedBy,
        inputType: inputType || "NUMBER_OR_TEXT",
        scheduledAt,
        timezone: browserTimezone,
        localScheduledTime: `${startEditDate}T${startEditTime}:00`,
        scheduledUndoAt: null,
        value: typeof value === "string" ? { value } : value,
        searchKey,
        replaceText,
        locationId: location,
        filterParams: [],
        targetSnapshotId: targetSnapshotId || undefined,
        supportValue,
        canonicalPayload: {
          field: editedField,
          editType: editedBy,
          inputType: inputType || "NUMBER_OR_TEXT",
          value:
            typeof value === "string"
              ? { value }
              : value || { value: "" },
        },
      };

      const scheduleIdempotencyKey = `schedule:${editedField}:${editedBy}:${targetSnapshotId}:${scheduledAt}`;

      const response = await fetchWithAuth("/api/products/schedule-task", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": scheduleIdempotencyKey,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMessage = data?.message || data?.error || t("schedule_fail");

        if (data.code === "PRODUCT_LIMIT_EXCEEDED") {
          setUpgradeWarning(errorMessage);
          return;
        }

        if (data.code === "UPGRADE_REQUIRED") {
          setUpgradeWarning(errorMessage);
          return;
        }

        throw new Error(errorMessage);
      }

      // Show success toast
      setToastState({
        active: true,
        message: t("schedule_msg"),
        error: false,
      });

      resetForm();
      onHide();
      navigate("/history");
    } catch (error) {
      setError(error.message || t("try_again"));
      setToastState({
        active: true,
        message: error.message || t("try_again"),
        error: true,
      });
    } finally {
      setSubmitting(false);
      submitLockRef.current = false;
    }
  }, [
    isFormValid,
    startEditDate,
    startEditTime,
    undoStartEditChecked,
    editedField,
    editedBy,
    value,
    searchKey,
    replaceText,
    location,
    targetSnapshotId,
    supportValue,
    resetForm,
    onHide,
    navigate,
    fetchWithAuth,
    setToastState,
    browserTimezone,
    t,
    typedConfirmValid,
    isFormValid,
  ]);

  // Toast to show success/error messages
  const toastMarkup = toastState.active ? (
    <Toast
      content={toastState.message}
      error={toastState.error}
      onDismiss={() =>
        setToastState({ active: false, message: "", error: false })
      }
    />
  ) : null;

  return (
    <>
      <Modal
        open={show}
        onClose={() => {
          if (submitting) return;
          resetForm();
          onHide();
        }}
        title={t("scheduleEditLabel")}
        primaryAction={{
          content: t("schedule"),
          onAction: handleScheduleEdit,
          loading: submitting,
          disabled: !isFormValid || !typedConfirmValid || submitting,
        }}
        secondaryActions={[
          {
            content: t("cancel"),
            onAction: () => {
              if (submitting) return;
              resetForm();
              onHide();
            },
            disabled: submitting,
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            {upgradeWarning && (
              <Banner
                tone="warning"
                title={t("upgradeRequired", { defaultValue: "Upgrade Required" })}
                onDismiss={() => setUpgradeWarning(null)}
                action={{
                  content: t("upgradePlan", { defaultValue: "Upgrade Plan" }),
                  onAction: () => navigate("/pricing"),
                }}
              >
                <p>{upgradeWarning}</p>
              </Banner>
            )}

            {error && (
              <Banner tone="critical" onDismiss={() => setError(null)}>
                {error}
              </Banner>
            )}

            <Checkbox
              label={t("startEditTime")}
              checked={startEditChecked}
              onChange={(checked) => handleCheckboxChange(checked, "start")}
            />

            {startEditChecked && (
              <FormLayout.Group>
                <TextField
                  label={t("date")}
                  type="date"
                  value={startEditDate}
                  onChange={(value) => handleDateChange(value, "start")}
                  helpText={t("selectDateRunEdit")}
                  min={new Date().toISOString().split("T")[0]} // Today or later
                />
                <TextField
                  label={t("time")}
                  type="time"
                  value={startEditTime}
                  onChange={(value) => handleTimeChange(value, "start")}
                  helpText={t("selectTimeRunEdit")}
                />
              </FormLayout.Group>
            )}

            <Box paddingBlockStart="400">
              <Banner tone="info">
                <Text as="p">
                  {t("scheduledUndoPostExecutionOnly", {
                    defaultValue:
                      "Undo scheduling is available after the scheduled execution completes successfully.",
                  })}
                </Text>
              </Banner>
            </Box>

            {requiresTypedConfirmation ? (
              <TextField
                label={t("scheduledTypedConfirmLabel", {
                  defaultValue: `Type ${SCHEDULE_CONFIRM_TEXT} to continue`,
                })}
                value={scheduleConfirmText}
                onChange={setScheduleConfirmText}
                autoComplete="off"
                disabled={submitting}
              />
            ) : null}

            {scheduledPreview && (
              <Box paddingBlockStart="400">
                <Banner tone="info">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      {t("scheduledEditPreviewTitle", {
                        defaultValue: "Schedule preview",
                      })}
                    </Text>
                    <Text as="p" variant="bodyMd">
                      {scheduledPreview.runLine}
                    </Text>
                    <Text as="p" variant="bodyMd">
                      {scheduledPreview.matchesLine}
                    </Text>
                    <Text as="p" variant="bodyMd">
                      {scheduledPreview.nextRunLine}
                    </Text>
                    <Text as="p" variant="bodyMd">
                      {scheduledPreview.undoLine}
                    </Text>
                  </BlockStack>
                </Banner>
              </Box>
            )}
          </FormLayout>
        </Modal.Section>
      </Modal>
      {toastMarkup}
    </>
  );
}

export default React.memo(ScheduleEdit);
  const SCHEDULE_CONFIRM_TEXT = "SCHEDULE";
  const LARGE_SCHEDULE_THRESHOLD = 1000;
  const DESTRUCTIVE_FIELDS = new Set([
    "status",
    "price",
    "inventory",
    "deleteProducts",
  ]);
