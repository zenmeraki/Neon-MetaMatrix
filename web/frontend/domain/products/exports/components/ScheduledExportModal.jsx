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
import { useAuthenticatedFetch } from "../../../../hooks/useAuthenticatedFetch";

import { useTranslation } from "react-i18next";

function ScheduledExportModal({
  show,
  onHide,
  fileName,
  selectedFields,
  preset,
  filters,
  targetSnapshotId,
}) {
  const { t } = useTranslation();
  const fetchWithAuth = useAuthenticatedFetch();

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
    if (!isFormValid) return;

    setSubmitting(true);
    setError(null);
    setUpgradeWarning(null);

    try {
      const scheduledAt = new Date(
        `${startExportDate}T${startExportTime}:00`
      ).toISOString();

      const payload = {
        title: fileName.replace(/\.csv$/i, ""),
        filename: fileName,
        fields: selectedFields,
        preset: preset || "custom",
        filterParams: filters,
        targetSnapshotId: targetSnapshotId || undefined,
        scheduledAt,
        status: "Active",
      };

      const response = await fetchWithAuth(
        "/api/products/create-scheduled-export",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        const errorCode =
          data?.code || data?.message || "SCHEDULED_EXPORT_FAILED";

        // 🔥 Upgrade case
        if (errorCode === "SCHEDULED_EXPORT_PLAN_UPGRADE_REQUIRED") {
          setUpgradeWarning(t("scheduledExport.upgradeRequiredMessage"));
          return;
        }

        // 🔥 Generic errors
        throw new Error(
          t(
            `scheduledExport.errors.${errorCode}`,
            t("scheduledExport.failedMessage")
          )
        );
      }

      // ✅ Success
      setToastState({
        active: true,
        message: t("scheduledExport.successMessage"),
        error: false,
      });

      setTimeout(() => {
        handleClose();
        navigate("/history");
      }, 1000);
    } catch (requestError) {
      const message =
        requestError?.message || t("scheduledExport.failedMessage");

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
    fileName,
    filters,
    targetSnapshotId,
    handleClose,
    isFormValid,
    navigate,
    selectedFields,
    startExportDate,
    startExportTime,
    fetchWithAuth,
    t,
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
        title={t("scheduledExport.modalTitle")}
        primaryAction={{
          content: t("scheduledExport.scheduleButton"),
          onAction: handleScheduleExport,
          loading: submitting,
          disabled: !isFormValid || submitting,
        }}
        secondaryActions={[
          {
            content: t("scheduledExport.cancelButton"),
            onAction: handleClose,
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            {upgradeWarning && (
              <Banner
                tone="warning"
                title={t("scheduledExport.upgradeRequiredTitle")}
                onDismiss={() => setUpgradeWarning(null)}
                action={{
                  content: t("scheduledExport.upgradePlanButton"),
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
              label={t("scheduledExport.startExportCheckbox")}
              checked={startExportChecked}
              onChange={(checked) => setStartExportChecked(checked)}
            />

            {startExportChecked && (
              <FormLayout.Group>
                <TextField
                  label={t("scheduledExport.dateLabel")}
                  type="date"
                  value={startExportDate}
                  onChange={setStartExportDate}
                  helpText={t("scheduledExport.dateHelpText")}
                  min={new Date().toISOString().split("T")[0]}
                />
                <TextField
                  label={t("scheduledExport.timeLabel")}
                  type="time"
                  value={startExportTime}
                  onChange={setStartExportTime}
                  helpText={t("scheduledExport.timeHelpText")}
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
