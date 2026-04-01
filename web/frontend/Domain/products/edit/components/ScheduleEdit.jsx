import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Modal,
  FormLayout,
  Checkbox,
  TextField,
  Banner,
  InlineStack,
  Text,
  Box,
  Frame,
  Toast,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";

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
  supportValue,
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();

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

  const handleDateChange = useCallback((nextValue, type) => {
    if (type === "start") {
      setStartEditDate(nextValue);
    } else {
      setUndoStartEditDate(nextValue);
    }
  }, []);

  const handleTimeChange = useCallback((nextValue, type) => {
    if (type === "start") {
      setStartEditTime(nextValue);
    } else {
      setUndoStartEditTime(nextValue);
    }
  }, []);

  const handleCheckboxChange = useCallback((checked, type) => {
    if (type === "start") {
      setStartEditChecked(checked);
      if (!checked) {
        setStartEditDate("");
        setStartEditTime("");
      }
      return;
    }

    setUndoStartEditChecked(checked);
    if (!checked) {
      setUndoStartEditDate("");
      setUndoStartEditTime("");
    }
  }, []);

  const resetForm = useCallback(() => {
    setStartEditChecked(false);
    setUndoStartEditChecked(false);
    setStartEditDate("");
    setStartEditTime("");
    setUndoStartEditDate("");
    setUndoStartEditTime("");
    setUpgradeWarning(null);
    setError(null);
  }, []);

  const handleScheduleEdit = useCallback(async () => {
    if (!isFormValid) return;

    setSubmitting(true);
    setError(null);

    try {
      const scheduledAt = new Date(
        `${startEditDate}T${startEditTime}:00`,
      ).toISOString();

      const scheduledUndoAt =
        undoStartEditChecked && undoStartEditDate && undoStartEditTime
          ? new Date(
              `${undoStartEditDate}T${undoStartEditTime}:00`,
            ).toISOString()
          : null;

      const payload = {
        editedField,
        editedBy,
        scheduledAt,
        scheduledUndoAt,
        value,
        searchKey,
        replaceText,
        location,
        filterParams: filters,
        supportValue,
      };

      const response = await fetch("/api/products/schedule-task", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        if (
          data.code === "PRODUCT_LIMIT_EXCEEDED" ||
          data.code === "UPGRADE_REQUIRED"
        ) {
          setUpgradeWarning(data.message);
          return;
        }

        throw new Error(data.message || t("schedule_fail"));
      }

      setToastState({
        active: true,
        message: t("schedule_msg"),
        error: false,
      });

      setTimeout(() => {
        resetForm();
        onHide();
        navigate("/history");
      }, 1000);
    } catch (requestError) {
      const message = requestError.message || t("try_again");
      setError(message);
      setToastState({
        active: true,
        message,
        error: true,
      });
    } finally {
      setSubmitting(false);
    }
  }, [
    editedBy,
    editedField,
    filters,
    isFormValid,
    location,
    navigate,
    onHide,
    replaceText,
    resetForm,
    searchKey,
    startEditDate,
    startEditTime,
    supportValue,
    t,
    undoStartEditChecked,
    undoStartEditDate,
    undoStartEditTime,
    value,
  ]);

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
    <Frame>
      <Modal
        open={show}
        onClose={() => {
          resetForm();
          onHide();
        }}
        title={t("scheduleEditLabel")}
        primaryAction={{
          content: t("schedule"),
          onAction: handleScheduleEdit,
          loading: submitting,
          disabled: !isFormValid || submitting,
        }}
        secondaryActions={[
          {
            content: t("cancel"),
            onAction: () => {
              resetForm();
              onHide();
            },
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            {upgradeWarning && (
              <Banner
                tone="warning"
                title={t("upgradeRequiredTitle", {
                  defaultValue: "Upgrade required",
                })}
                onDismiss={() => setUpgradeWarning(null)}
                action={{
                  content: t("upgradePlanButton", {
                    defaultValue: "Upgrade plan",
                  }),
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
                  onChange={(nextValue) => handleDateChange(nextValue, "start")}
                  helpText={t("selectDateRunEdit")}
                  min={new Date().toISOString().split("T")[0]}
                  autoComplete="off"
                />
                <TextField
                  label={t("time")}
                  type="time"
                  value={startEditTime}
                  onChange={(nextValue) => handleTimeChange(nextValue, "start")}
                  helpText={t("selectTimeRunEdit")}
                  autoComplete="off"
                />
              </FormLayout.Group>
            )}

            <Box paddingBlockStart="400">
              <Checkbox
                label={t("scheduleUndo")}
                checked={undoStartEditChecked}
                onChange={(checked) => handleCheckboxChange(checked, "undo")}
                disabled={!startEditChecked}
                helpText={t("revertChangesNote")}
              />
            </Box>

            {undoStartEditChecked && (
              <FormLayout.Group>
                <TextField
                  label={t("undoDate")}
                  type="date"
                  value={undoStartEditDate}
                  onChange={(nextValue) => handleDateChange(nextValue, "undo")}
                  helpText={t("selectDateUndoEdit")}
                  min={startEditDate || new Date().toISOString().split("T")[0]}
                  autoComplete="off"
                />
                <TextField
                  label={t("undoTime")}
                  type="time"
                  value={undoStartEditTime}
                  onChange={(nextValue) => handleTimeChange(nextValue, "undo")}
                  helpText={t("selectTimeUndoEdit")}
                  autoComplete="off"
                />
              </FormLayout.Group>
            )}

            {startEditChecked && startEditDate && startEditTime && (
              <Box paddingBlockStart="400">
                <Banner tone="info">
                  <InlineStack gap="200" direction="vertical">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      {t("scheduleSummaryTitle", {
                        defaultValue: "Edit summary",
                      })}
                    </Text>
                    <Text as="p" variant="bodyMd">
                      {t("scheduleSummaryField", {
                        defaultValue: "Field: {{field}}",
                        field: editedField,
                      })}
                    </Text>
                    <Text as="p" variant="bodyMd">
                      {t("scheduleSummaryProducts", {
                        defaultValue: "Products: {{count}}",
                        count,
                      })}
                    </Text>
                    <Text as="p" variant="bodyMd">
                      {t("scheduleSummaryStart", {
                        defaultValue: "Scheduled for: {{date}} at {{time}}",
                        date: startEditDate,
                        time: startEditTime,
                      })}
                    </Text>
                    {undoStartEditChecked &&
                      undoStartEditDate &&
                      undoStartEditTime && (
                        <Text as="p" variant="bodyMd">
                          {t("scheduleSummaryUndo", {
                            defaultValue:
                              "Undo scheduled for: {{date}} at {{time}}",
                            date: undoStartEditDate,
                            time: undoStartEditTime,
                          })}
                        </Text>
                      )}
                  </InlineStack>
                </Banner>
              </Box>
            )}
          </FormLayout>
        </Modal.Section>
      </Modal>
      {toastMarkup}
    </Frame>
  );
}

export default React.memo(ScheduleEdit);
