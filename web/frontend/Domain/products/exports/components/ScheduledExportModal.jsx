import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Modal,
  FormLayout,
  Checkbox,
  TextField,
  Banner,
  Box,
  Frame,
  Toast,
} from "@shopify/polaris";

function ScheduledExportModal({
  show,
  onHide,
  fileName,
  selectedFields,
  filters,
}) {
  const navigate = useNavigate();
  const [startExportChecked, setStartExportChecked] = useState(true);
  const [startExportDate, setStartExportDate] = useState("");
  const [startExportTime, setStartExportTime] = useState("");
  const [upgradeWarning, setUpgradeWarning] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [toastState, setToastState] = useState({
    active: false,
    message: "",
    error: false,
  });

  const isFormValid =
    startExportChecked &&
    Boolean(startExportDate) &&
    Boolean(startExportTime) &&
    Boolean(fileName?.trim()) &&
    Array.isArray(selectedFields) &&
    selectedFields.length > 0;

  const resetForm = useCallback(() => {
    setStartExportChecked(true);
    setStartExportDate("");
    setStartExportTime("");
    setUpgradeWarning(null);
    setSubmitting(false);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onHide();
  }, [onHide, resetForm]);

  const handleScheduleExport = useCallback(async () => {
    if (!isFormValid) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setUpgradeWarning(null);

    try {
      const scheduledAt = new Date(
        `${startExportDate}T${startExportTime}:00`,
      ).toISOString();

      const payload = {
        title: fileName.replace(/\.csv$/i, ""),
        filename: fileName,
        fields: selectedFields,
        filterParams: filters,
        scheduledAt,
        status: "Active",
      };

      const response = await fetch("/api/products/create-scheduled-export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        const message = data?.message || "Failed to create scheduled export";

        if (
          message.toLowerCase().includes("plan") ||
          message.toLowerCase().includes("advanced") ||
          message.toLowerCase().includes("pro")
        ) {
          setUpgradeWarning(message);
          return;
        }

        throw new Error(message);
      }

      setToastState({
        active: true,
        message: "Export scheduled successfully!",
        error: false,
      });

      setTimeout(() => {
        handleClose();
        navigate("/history");
      }, 1000);
    } catch (requestError) {
      setError(requestError.message || "Failed to schedule export");
      setToastState({
        active: true,
        message: requestError.message || "Failed to schedule export",
        error: true,
      });
    } finally {
      setSubmitting(false);
    }
  }, [
    fileName,
    filters,
    handleClose,
    isFormValid,
    navigate,
    selectedFields,
    startExportDate,
    startExportTime,
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
        onClose={handleClose}
        title="Schedule Export"
        primaryAction={{
          content: "Schedule",
          onAction: handleScheduleExport,
          loading: submitting,
          disabled: !isFormValid || submitting,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: handleClose,
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
              <Banner tone="critical" onDismiss={() => setError(null)}>
                <p>{error}</p>
              </Banner>
            )}

            <Checkbox
              label="Start export at scheduled time"
              checked={startExportChecked}
              onChange={(checked) => setStartExportChecked(checked)}
            />

            {startExportChecked && (
              <FormLayout.Group>
                <TextField
                  label="Date"
                  type="date"
                  value={startExportDate}
                  onChange={setStartExportDate}
                  helpText="Select the date to run the export"
                  min={new Date().toISOString().split("T")[0]}
                />
                <TextField
                  label="Time"
                  type="time"
                  value={startExportTime}
                  onChange={setStartExportTime}
                  helpText="Select the time to run the export"
                />
              </FormLayout.Group>
            )}

            <Box paddingBlockStart="200" />
          </FormLayout>
        </Modal.Section>
      </Modal>
      {toastMarkup}
    </Frame>
  );
}

export default React.memo(ScheduledExportModal);