import React, { useState, useCallback, useEffect } from "react";
import {
  Modal,
  LegacyCard,
  FormLayout,
  TextField,
  Select,
  Button,
  Banner,
  Text,
  Link,
  Checkbox,
  Tag,
  Box,
  BlockStack,
  InlineStack,
  Badge,
  ProgressBar,
  Divider,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";

const RecurringEditModal = ({ open, onClose, data, isLoading, error, onUpdated }) => {
  const { t } = useTranslation();

  // Generate time slots every 15 minutes
  const generateTimeSlots = () => {
    const slots = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 15) {
        const hh = String(h).padStart(2, "0");
        const mm = String(m).padStart(2, "0");
        const time24 = `${hh}:${mm}`;

        // Convert to 12-hour format for display
        let displayHour = h;
        const ampm = h >= 12 ? "PM" : "AM";
        if (h === 0) displayHour = 12;
        else if (h > 12) displayHour = h - 12;

        const displayTime = `${displayHour}:${mm} ${ampm}`;

        slots.push({
          label: displayTime,
          value: time24,
        });
      }
    }
    return slots;
  };

  // Form state
  const [formData, setFormData] = useState({
    title: "",
    frequency: "Daily",
    status: "Active",
    timeToRun: "12:00",
    timezone: "Asia/Kolkata",
    dayOfMonthToRun: 1,
    daysOfWeekToRun: [],
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [validationErrors, setValidationErrors] = useState({});

  // Options for dropdowns
  const frequencyOptions = [
    { label: "Hourly", value: "Hourly" },
    { label: "Every 2 Hours", value: "Every 2 Hours" },
    { label: "Daily", value: "Daily" },
    { label: "Weekly", value: "Weekly" },
    { label: "Monthly", value: "Monthly" },
  ];

  const statusOptions = [
    { label: "Active", value: "Active" },
    { label: "Inactive", value: "Inactive" },
  ];

  const timezoneOptions = [
    { label: "Asia/Kolkata (IST)", value: "Asia/Kolkata" },
    { label: "UTC", value: "UTC" },
    { label: "America/New_York (EST/EDT)", value: "America/New_York" },
    { label: "Europe/London (GMT/BST)", value: "Europe/London" },
    { label: "Asia/Tokyo (JST)", value: "Asia/Tokyo" },
  ];

  const daysOfWeek = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  const timeSlotOptions = generateTimeSlots();

  // Generate day of month options (1-31)
  const dayOfMonthOptions = Array.from({ length: 31 }, (_, i) => ({
    label: `${i + 1}${getOrdinalSuffix(i + 1)}`,
    value: String(i + 1),
  }));

  function getOrdinalSuffix(day) {
    if (day >= 11 && day <= 13) return "th";
    switch (day % 10) {
      case 1:
        return "st";
      case 2:
        return "nd";
      case 3:
        return "rd";
      default:
        return "th";
    }
  }

  // Helper function to format dates
  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    try {
      const date = new Date(dateString);
      return date.toLocaleString();
    } catch {
      return "Invalid date";
    }
  };

  // Helper function to get status badge
  const getStatusBadge = (status) => {
    const normalizedStatus = status?.toLowerCase();
    let tone = "attention";

    switch (normalizedStatus) {
      case "active":
        tone = "success";
        break;
      case "inactive":
      case "paused":
        tone = "warning";
        break;
      case "completed":
        tone = "info";
        break;
      case "failed":
        tone = "critical";
        break;
      case "expired":
        tone = "subdued";
        break;
      default:
        tone = "attention";
    }

    return <Badge tone={tone}>{status}</Badge>;
  };

  // Helper function to get last run status badge
  const getLastRunStatusBadge = (status) => {
    const normalizedStatus = status?.toLowerCase();
    let tone = "attention";

    switch (normalizedStatus) {
      case "success":
        tone = "success";
        break;
      case "failed":
      case "error":
        tone = "critical";
        break;
      case "running":
      case "processing":
        tone = "info";
        break;
      case "skipped":
        tone = "warning";
        break;
      default:
        tone = "attention";
    }

    return <Badge tone={tone}>{status}</Badge>;
  };

  // Calculate success rate
  const getSuccessRate = (totalRuns, totalRunsSucceed) => {
    if (!totalRuns || totalRuns === 0) return 0;
    return Math.round((totalRunsSucceed / totalRuns) * 100);
  };

  // Populate form with existing data
  useEffect(() => {
    if (data && open) {
      setFormData({
        title: data.title || "",
        frequency: data.frequency || "Daily",
        status: data.status || "Active",
        timeToRun: data.timeToRun || "12:00",
        timezone: data.timezone || "Asia/Kolkata",
        dayOfMonthToRun: data.dayOfMonthToRun || 1,
        daysOfWeekToRun: data.daysOfWeekToRun || [],
      });
    }
  }, [data, open]);

  // Handle form field changes
  const handleFieldChange = useCallback(
    (field, value) => {
      setFormData((prev) => ({
        ...prev,
        [field]: value,
      }));

      // Clear validation error for this field
      if (validationErrors[field]) {
        setValidationErrors((prev) => ({
          ...prev,
          [field]: null,
        }));
      }
    },
    [validationErrors]
  );

  // Handle day of week selection for weekly frequency
  const handleDayOfWeekChange = useCallback(
    (day, checked) => {
      setFormData((prev) => ({
        ...prev,
        daysOfWeekToRun: checked
          ? [...prev.daysOfWeekToRun, day]
          : prev.daysOfWeekToRun.filter((d) => d !== day),
      }));

      if (validationErrors.daysOfWeekToRun) {
        setValidationErrors((prev) => ({
          ...prev,
          daysOfWeekToRun: null,
        }));
      }
    },
    [validationErrors]
  );

  // Client-side validation
  const validateForm = () => {
    const errors = {};

    // Title validation
    if (!formData.title.trim()) {
      errors.title = "Title is required";
    }

    // Time validation for Daily, Weekly, Monthly
    if (["Daily", "Weekly", "Monthly"].includes(formData.frequency)) {
      if (!formData.timeToRun) {
        errors.timeToRun = "Time to run is required for this frequency";
      }
    }

    // Day of month validation for Monthly
    if (formData.frequency === "Monthly") {
      if (!formData.dayOfMonthToRun) {
        errors.dayOfMonthToRun =
          "Day of month is required for monthly frequency";
      }
    }

    // Days of week validation for Weekly
    if (formData.frequency === "Weekly") {
      if (formData.daysOfWeekToRun.length === 0) {
        errors.daysOfWeekToRun =
          "At least one day must be selected for weekly frequency";
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");

    try {
      const requestBody = {
        title: formData.title,
        frequency: formData.frequency,
        status: formData.status,
        timezone: formData.timezone,
      };

      // Add conditional fields based on frequency
      if (["Daily", "Weekly", "Monthly"].includes(formData.frequency)) {
        requestBody.timeToRun = formData.timeToRun;
      }

      if (formData.frequency === "Monthly") {
        requestBody.dayOfMonthToRun = parseInt(formData.dayOfMonthToRun);
      }

      if (formData.frequency === "Weekly") {
        requestBody.daysOfWeekToRun = formData.daysOfWeekToRun;
      }

      const response = await fetch(`/api/products/update-recurring-edit/${data.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const responseData = await response.json();

      if (!response.ok) {
        if (response.status === 400 && responseData.details) {
          setValidationErrors(responseData.details);
          throw new Error(responseData.message || "Validation failed");
        }
        throw new Error(
          responseData.message || "Failed to update recurring edit"
        );
      }

      // Success - close modal
      if (typeof onUpdated === "function") {
        await onUpdated();
      }

      handleClose();

      // You might want to call a success callback here
      // onSuccess?.(responseData);
    } catch (error) {
      console.error("Error updating recurring edit:", error);
      setSubmitError(error.message || "Failed to update recurring edit");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle modal close
  const handleClose = () => {
    setFormData({
      title: "",
      frequency: "Daily",
      status: "Active",
      timeToRun: "12:00",
      timezone: "Asia/Kolkata",
      dayOfMonthToRun: 1,
      daysOfWeekToRun: [],
    });
    setSubmitError("");
    setValidationErrors({});
    onClose();
  };

  // Render frequency-specific fields
  const renderFrequencySpecificFields = () => {
    const { frequency } = formData;

    if (["Hourly", "Every 2 Hours"].includes(frequency)) {
      return (
        <Banner tone="info">
          <Text variant="bodyMd" as="p">
            This job will run automatically every {frequency.toLowerCase()}
            based on your selected timezone.
          </Text>
        </Banner>
      );
    }

    if (["Daily", "Weekly", "Monthly"].includes(frequency)) {
      return (
        <BlockStack gap="400">
          <Select
            label="Time to Run"
            options={timeSlotOptions}
            value={formData.timeToRun}
            onChange={(value) => handleFieldChange("timeToRun", value)}
            disabled={isSubmitting}
            error={validationErrors.timeToRun}
            requiredIndicator
          />

          {frequency === "Weekly" && (
            <BlockStack gap="200">
              <Text variant="bodyMd" as="p" fontWeight="semibold">
                Days of Week{" "}
                <Text as="span" tone="critical">
                  *
                </Text>
              </Text>
              <InlineStack gap="300" wrap>
                {daysOfWeek.map((day) => (
                  <Checkbox
                    key={day}
                    label={day}
                    checked={formData.daysOfWeekToRun.includes(day)}
                    onChange={(checked) => handleDayOfWeekChange(day, checked)}
                    disabled={isSubmitting}
                  />
                ))}
              </InlineStack>
              {validationErrors.daysOfWeekToRun && (
                <Text variant="bodyMd" as="p" tone="critical">
                  {validationErrors.daysOfWeekToRun}
                </Text>
              )}
            </BlockStack>
          )}

          {frequency === "Monthly" && (
            <Select
              label="Day of Month"
              options={dayOfMonthOptions}
              value={String(formData.dayOfMonthToRun)}
              onChange={(value) =>
                handleFieldChange("dayOfMonthToRun", parseInt(value))
              }
              disabled={isSubmitting}
              error={validationErrors.dayOfMonthToRun}
              helpText="Note: Jobs scheduled for days 29-31 may not run in shorter months"
              requiredIndicator
            />
          )}
        </BlockStack>
      );
    }

    return null;
  };

  if (isLoading) {
    return (
      <Modal open={open} onClose={onClose} title="Loading..." size="large">
        <Modal.Section>
          <Box padding="400" textAlign="center">
            <Text as="p" tone="subdued">
              Loading recurring edit details...
            </Text>
          </Box>
        </Modal.Section>
      </Modal>
    );
  }

  if (error || !data) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Error"
        size="large"
        secondaryActions={[
          {
            content: "Close",
            onAction: onClose,
          },
        ]}
      >
        <Modal.Section>
          <Banner tone="critical">
            <Text as="p">
              {error || "Failed to load recurring edit details"}
            </Text>
          </Banner>
        </Modal.Section>
      </Modal>
    );
  }

  const {
    shop,
    queryFilter,
    totalItems,
    processedCount,
    totalRuns,
    totalRunsSucceed,
    totalRunsSkipped,
    totalFails,
    lastRunAt,
    lastRunStatus,
    lastRunMessage,
    steps,
    createdAt,
    updatedAt,
    durationMs,
    isCurrentlyRunning,
  } = data;

  const successRate = getSuccessRate(totalRuns, totalRunsSucceed);
  const user = shop?.split(".")[0] || "Unknown";

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Edit Recurring Schedule"
      primaryAction={{
        content: "Update Recurring Edit",
        onAction: handleSubmit,
        loading: isSubmitting,
        disabled: isSubmitting,
      }}
      secondaryActions={[
        {
          content: "Cancel",
          onAction: handleClose,
          disabled: isSubmitting,
        },
      ]}
      size="large"
    >
      <Modal.Section>
        <BlockStack gap="500">
          {submitError && (
            <Banner tone="critical" onDismiss={() => setSubmitError("")}>
              {submitError}
            </Banner>
          )}

          {/* Edit Form */}
          <LegacyCard sectioned>
            <FormLayout>
              {/* Title Field */}
              <TextField
                label="Title"
                value={formData.title}
                onChange={(value) => handleFieldChange("title", value)}
                placeholder="Enter a descriptive title for this recurring edit"
                disabled={isSubmitting}
                error={validationErrors.title}
                requiredIndicator
              />

              {/* Frequency and Status Row */}
              <FormLayout.Group>
                <Select
                  label="Frequency"
                  options={frequencyOptions}
                  value={formData.frequency}
                  onChange={(value) => handleFieldChange("frequency", value)}
                  disabled={isSubmitting}
                  helpText="How often should this edit run?"
                />
                <Select
                  label="Status"
                  options={statusOptions}
                  value={formData.status}
                  onChange={(value) => handleFieldChange("status", value)}
                  disabled={isSubmitting}
                  helpText="Set to Inactive to pause scheduling"
                />
              </FormLayout.Group>

              {/* Timezone */}
              <Select
                label="Timezone"
                options={timezoneOptions}
                value={formData.timezone}
                onChange={(value) => handleFieldChange("timezone", value)}
                disabled={isSubmitting}
                helpText="All times will be interpreted in this timezone"
              />

              {/* Frequency-specific fields */}
              {renderFrequencySpecificFields()}
            </FormLayout>
          </LegacyCard>

          {/* Current Steps Section */}
          <LegacyCard sectioned>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h3">
                Current Edit Steps
              </Text>
              <Text variant="bodyMd" as="p" tone="subdued">
                This recurring edit performs the following actions:
              </Text>
              <BlockStack gap="200">
                {steps?.map((step, index) => (
                  <Box
                    key={index}
                    padding="300"
                    background="bg-surface-secondary"
                    borderRadius="200"
                    borderColor="border-secondary"
                    borderWidth="025"
                  >
                    <Text variant="bodyMd" as="p">
                      <Text as="span" fontWeight="semibold">
                        Step {index + 1}:
                      </Text>{" "}
                      Edit <Tag>{step.field}</Tag> using "{step.editType}" to
                      value "
                      <Text as="span" fontWeight="semibold">
                        {step.value}
                      </Text>
                      "
                    </Text>
                  </Box>
                ))}
              </BlockStack>
            </BlockStack>
          </LegacyCard>

          <Divider />

          {/* Execution Details Section */}
          <LegacyCard sectioned>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="start">
                <Text variant="headingMd" as="h3">
                  Execution Details
                </Text>
                <InlineStack gap="200">
                  {getStatusBadge(data.status)}
                  {isCurrentlyRunning && (
                    <Badge tone="info">Currently Running</Badge>
                  )}
                </InlineStack>
              </InlineStack>

              <BlockStack gap="400">
                {/* Basic Info */}
                <InlineStack gap="800" wrap>
                  <Box>
                    <Text variant="bodyMd" as="p" tone="subdued">
                      Shop
                    </Text>
                    <Text variant="bodyMd" as="p" fontWeight="semibold">
                      {user}
                    </Text>
                  </Box>
                  <Box>
                    <Text variant="bodyMd" as="p" tone="subdued">
                      Query Filter
                    </Text>
                    <Text variant="bodyMd" as="p" fontWeight="semibold">
                      {queryFilter || "None"}
                    </Text>
                  </Box>
                  <Box>
                    <Text variant="bodyMd" as="p" tone="subdued">
                      Total Products
                    </Text>
                    <Text variant="bodyMd" as="p" fontWeight="semibold">
                      {totalItems || 0}
                    </Text>
                  </Box>
                </InlineStack>

                {/* Statistics */}
                <BlockStack gap="300">
                  <Text variant="bodyMd" as="p" fontWeight="semibold">
                    Run Statistics
                  </Text>
                  <InlineStack gap="800" wrap>
                    <Box>
                      <Text variant="bodyMd" as="p" tone="subdued">
                        Total Runs
                      </Text>
                      <Text variant="headingLg" as="p">
                        {totalRuns || 0}
                      </Text>
                    </Box>
                    <Box>
                      <Text variant="bodyMd" as="p" tone="subdued">
                        Successful Runs
                      </Text>
                      <Text variant="headingLg" as="p" tone="success">
                        {totalRunsSucceed || 0}
                      </Text>
                    </Box>
                    <Box>
                      <Text variant="bodyMd" as="p" tone="subdued">
                        Failed Runs
                      </Text>
                      <Text variant="headingLg" as="p" tone="critical">
                        {totalFails || 0}
                      </Text>
                    </Box>
                    <Box>
                      <Text variant="bodyMd" as="p" tone="subdued">
                        Success Rate
                      </Text>
                      <Text
                        variant="headingLg"
                        as="p"
                        tone={
                          successRate >= 80
                            ? "success"
                            : successRate >= 50
                            ? "warning"
                            : "critical"
                        }
                      >
                        {successRate}%
                      </Text>
                    </Box>
                  </InlineStack>

                  {totalRuns > 0 && (
                    <Box>
                      <ProgressBar
                        progress={successRate}
                        size="small"
                        tone={
                          successRate >= 80
                            ? "success"
                            : successRate >= 50
                            ? "primary"
                            : "critical"
                        }
                      />
                    </Box>
                  )}
                </BlockStack>

                {/* Last Run Information */}
                <BlockStack gap="300">
                  <Text variant="bodyMd" as="p" fontWeight="semibold">
                    Last Run Information
                  </Text>
                  <InlineStack gap="800" wrap>
                    <Box>
                      <Text variant="bodyMd" as="p" tone="subdued">
                        Last Run At
                      </Text>
                      <Text variant="bodyMd" as="p" fontWeight="semibold">
                        {formatDate(lastRunAt?.$date || lastRunAt)}
                      </Text>
                    </Box>
                    <Box>
                      <Text variant="bodyMd" as="p" tone="subdued">
                        Status
                      </Text>
                      <Box paddingBlockStart="100">
                        {getLastRunStatusBadge(lastRunStatus)}
                      </Box>
                    </Box>
                    <Box>
                      <Text variant="bodyMd" as="p" tone="subdued">
                        Duration
                      </Text>
                      <Text variant="bodyMd" as="p" fontWeight="semibold">
                        {durationMs
                          ? `${(durationMs / 1000).toFixed(2)}s`
                          : "N/A"}
                      </Text>
                    </Box>
                  </InlineStack>
                  {lastRunMessage && (
                    <Box>
                      <Text variant="bodyMd" as="p" tone="subdued">
                        Last Message
                      </Text>
                      <Text variant="bodyMd" as="p" fontWeight="semibold">
                        {lastRunMessage}
                      </Text>
                    </Box>
                  )}
                </BlockStack>

                {/* Timestamps */}
                <BlockStack gap="200">
                  <Text variant="bodyMd" as="p" fontWeight="semibold">
                    Timestamps
                  </Text>
                  <InlineStack gap="800" wrap>
                    <Box>
                      <Text variant="bodyMd" as="p" tone="subdued">
                        Created
                      </Text>
                      <Text variant="bodyMd" as="p" fontWeight="semibold">
                        {formatDate(createdAt?.$date || createdAt)}
                      </Text>
                    </Box>
                    <Box>
                      <Text variant="bodyMd" as="p" tone="subdued">
                        Last Updated
                      </Text>
                      <Text variant="bodyMd" as="p" fontWeight="semibold">
                        {formatDate(updatedAt?.$date || updatedAt)}
                      </Text>
                    </Box>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </BlockStack>
          </LegacyCard>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
};

export default RecurringEditModal;