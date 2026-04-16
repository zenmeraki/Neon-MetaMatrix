import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Modal,
  Button,
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
  supportValue,
}) {
  const navigate = useNavigate();
  // State for form fields
  const [startEditChecked, setStartEditChecked] = useState(false);
  const [undoStartEditChecked, setUndoStartEditChecked] = useState(false);
  const [startEditDate, setStartEditDate] = useState("");
  const [startEditTime, setStartEditTime] = useState("");
  const [undoStartEditDate, setUndoStartEditDate] = useState("");
  const [undoStartEditTime, setUndoStartEditTime] = useState("");
  const [upgradeWarning, setUpgradeWarning] = useState(null);


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
    setError(null);
  }, []);

  // Handle schedule edit submission
  const handleScheduleEdit = useCallback(async () => {
    if (!isFormValid) return;

    setSubmitting(true);
    setError(null);

    try {
      const scheduledAt = new Date(
        `${startEditDate}T${startEditTime}:00`
      ).toISOString();

      const scheduledUndoAt =
        undoStartEditChecked && undoStartEditDate && undoStartEditTime
          ? new Date(
              `${undoStartEditDate}T${undoStartEditTime}:00`
            ).toISOString()
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

      // Reset form, close modal, and navigate to history
      setTimeout(() => {
        resetForm();
        onHide();
        navigate("/history");
      }, 1000);
    } catch (error) {
      console.error("Error scheduling edit:", error);
      setError(error.message || t("try_again"));
      setToastState({
        active: true,
        message: error.message || t("try_again"),
        error: true,
      });
    } finally {
      setSubmitting(false);
    }
  }, [
    isFormValid,
    startEditDate,
    startEditTime,
    undoStartEditChecked,
    undoStartEditDate,
    undoStartEditTime,
    editedField,
    editedBy,
    value,
    searchKey,
    replaceText,
    location,
    filters,
    supportValue,
    resetForm,
    onHide,
    navigate,
    setToastState,
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
    title="Upgrade Required"
    onDismiss={() => setUpgradeWarning(null)}
    action={{
      content: "Upgrade Plan",
      onAction: () => navigate("/pricing"),
    }}
  >
    <p>{upgradeWarning}</p>
  </Banner>
)}


            {error && (
              <Banner status="critical" onDismiss={() => setError(null)}>
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
                  onChange={(value) => handleDateChange(value, "undo")}
                  helpText={t("selectDateUndoEdit")}
                  min={startEditDate || new Date().toISOString().split("T")[0]} // Start date or today
                />
                <TextField
                  label={t("undoTime")}
                  type="time"
                  value={undoStartEditTime}
                  onChange={(value) => handleTimeChange(value, "undo")}
                  helpText={t("selectTimeUndoEdit")}
                />
              </FormLayout.Group>
            )}

            {startEditChecked && startEditDate && startEditTime && (
              <Box paddingBlockStart="400">
                <Banner status="info">
                  <InlineStack gap="200" direction="vertical">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      Edit Summary:
                    </Text>
                    <Text as="p" variant="bodyMd">
                      Field: <strong>{editedField}</strong>
                    </Text>
                    <Text as="p" variant="bodyMd">
                      Products: <strong>{count}</strong>
                    </Text>
                    <Text as="p" variant="bodyMd">
                      Scheduled for:{" "}
                      <strong>
                        {startEditDate} at {startEditTime}
                      </strong>
                    </Text>
                    {undoStartEditChecked &&
                      undoStartEditDate &&
                      undoStartEditTime && (
                        <Text as="p" variant="bodyMd">
                          Undo scheduled for:{" "}
                          <strong>
                            {undoStartEditDate} at {undoStartEditTime}
                          </strong>
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
