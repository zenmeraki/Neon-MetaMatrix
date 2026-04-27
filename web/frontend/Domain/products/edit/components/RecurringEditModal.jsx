import React, { useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Modal,
  FormLayout,
  TextField,
  Select,
  Banner,
  Checkbox,
  BlockStack,
  InlineStack,
  Text,
  Frame,
  Toast,
} from "@shopify/polaris";

import { useTranslation } from "react-i18next";

const TIMEZONE_OPTIONS = [
  { label: "Asia/Kolkata (IST)", value: "Asia/Kolkata" },
  { label: "UTC", value: "UTC" },
  { label: "America/New_York", value: "America/New_York" },
  { label: "America/Los_Angeles", value: "America/Los_Angeles" },
  { label: "Europe/London", value: "Europe/London" },
];

const FREQUENCY_OPTIONS = [
  { label: "Hourly", value: "Hourly" },
  { label: "Every 2 Hours", value: "Every 2 Hours" },
  { label: "Daily", value: "Daily" },
  { label: "Weekly", value: "Weekly" },
  { label: "Monthly", value: "Monthly" },
];

const DAYS_OF_WEEK = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function getDefaultTitle(editedField, editedBy, t) {
  const safeField = editedField
    ? t(`recurringEditFields.${editedField}`, { defaultValue: editedField })
    : t("recurringEditDefaultField");

  const safeEditType = editedBy
    ? t(`recurringEditEditTypes.${editedBy}`, { defaultValue: editedBy })
    : t("recurringEditDefaultEditType");

  return `${safeField} ${t("recurringEditDefaultTitleConnector")} ${safeEditType}`;
}

function getCurrentDateInputValue() {
  return new Date().toISOString().split("T")[0];
}

function buildIsoFromDateAndTime(dateValue, timeValue) {
  if (!dateValue || !timeValue) {
    return null;
  }

  return new Date(`${dateValue}T${timeValue}:00`).toISOString();
}

function RecurringEditModal({
  show,
  onHide,
  count,
  editedField,
  editedBy,
  value,
  searchKey,
  replaceText,
  location,
  filters,
  supportValue,
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const dayOfMonthOptions = useMemo(
    () =>
      Array.from({ length: 31 }, (_, index) => ({
        label: String(index + 1),
        value: String(index + 1),
      })),
    [],
  );

  const [title, setTitle] = useState(() =>
    getDefaultTitle(editedField, editedBy, t),
  );
  const [frequency, setFrequency] = useState("Daily");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [timeToRun, setTimeToRun] = useState("12:00");
  const [dayOfMonthToRun, setDayOfMonthToRun] = useState("1");
  const [daysOfWeekToRun, setDaysOfWeekToRun] = useState([]);
  const [hasStartAt, setHasStartAt] = useState(false);
  const [startDate, setStartDate] = useState(getCurrentDateInputValue());
  const [startTime, setStartTime] = useState("12:00");
  const [hasEndAt, setHasEndAt] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("12:00");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [upgradeWarning, setUpgradeWarning] = useState("");
  const [toastState, setToastState] = useState({
    active: false,
    message: "",
    error: false,
  });

  const resetForm = useCallback(() => {
    setTitle(getDefaultTitle(editedField, editedBy, t));
    setFrequency("Daily");
    setTimezone("Asia/Kolkata");
    setTimeToRun("12:00");
    setDayOfMonthToRun("1");
    setDaysOfWeekToRun([]);
    setHasStartAt(false);
    setStartDate(getCurrentDateInputValue());
    setStartTime("12:00");
    setHasEndAt(false);
    setEndDate("");
    setEndTime("12:00");
    setSubmitting(false);
    setError("");
    setUpgradeWarning("");
  }, [editedBy, editedField, t]);

  const handleClose = useCallback(() => {
    resetForm();
    onHide();
  }, [onHide, resetForm]);

  const handleWeekdayChange = useCallback((day, checked) => {
    setDaysOfWeekToRun((current) => {
      if (checked) {
        return current.includes(day) ? current : [...current, day];
      }

      return current.filter((item) => item !== day);
    });
  }, []);

  const requiresTime =
    frequency === "Daily" || frequency === "Weekly" || frequency === "Monthly";
  const needsWeekdaySelection = frequency === "Weekly";
  const needsDayOfMonthSelection = frequency === "Monthly";

  const validate = useCallback(() => {
    if (!title.trim()) {
      return t("recurringEditErrors.titleRequired");


    }

    if (needsWeekdaySelection && daysOfWeekToRun.length === 0) {
      return t("recurringEditErrors.weekdayRequired");

    }

    if (hasStartAt && !startDate) {
      return t("recurringEditErrors.startDateRequired");
    }

    if (hasEndAt && !endDate) {
      return t("recurringEditErrors.endDateRequired");

    }

    const startAt = hasStartAt
      ? buildIsoFromDateAndTime(startDate, startTime)
      : null;
    const endAt = hasEndAt ? buildIsoFromDateAndTime(endDate, endTime) : null;

    if (startAt && endAt && new Date(startAt) >= new Date(endAt)) {
      return t("recurringEditErrors.endAfterStart");
    }

    return "";
  }, [
    daysOfWeekToRun.length,
    endDate,
    endTime,
    hasEndAt,
    hasStartAt,
    needsWeekdaySelection,
    startDate,
    startTime,
    title,
  ]);

  const handleSubmit = useCallback(async () => {
    const validationMessage = validate();
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setSubmitting(true);
    setError("");
    setUpgradeWarning("");

    try {
      const payload = {
        title: title.trim(),
        frequency,
        timezone,
        filterParams: filters,
        editedField,
        editedBy,
        value,
        searchKey,
        replaceText,
        supportValue,
        locationId: location || null,
        status: "Active",
      };

      if (requiresTime) {
        payload.timeToRun = timeToRun;
      }

      if (needsWeekdaySelection) {
        payload.daysOfWeekToRun = daysOfWeekToRun;
      }

      if (needsDayOfMonthSelection) {
        payload.dayOfMonthToRun = Number.parseInt(dayOfMonthToRun, 10);
      }

      if (hasStartAt) {
        payload.startAt = buildIsoFromDateAndTime(startDate, startTime);
      }

      if (hasEndAt) {
        payload.endAt = buildIsoFromDateAndTime(endDate, endTime);
      }

      const response = await fetch("/api/products/create-recurring-edit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        const message =
  data?.message || t("recurringEditErrors.createFailed");

        if (response.status === 400 && message.toLowerCase().includes("pro")) {
          setUpgradeWarning(message);
          return;
        }

        setError(message);
        return;
      }

      setToastState({
        active: true,
        message: t("recurringEditSuccess.created"),
        error: false,
      });

      setTimeout(() => {
        handleClose();
        navigate("/history");
      }, 800);
    } catch (requestError) {
      setError(requestError.message || t("recurringEditErrors.createFailed"));
      setToastState({
        active: true,
        message: requestError.message || t("recurringEditErrors.createFailed"),
        error: true,
      });
    } finally {
      setSubmitting(false);
    }
  }, [
    dayOfMonthToRun,
    daysOfWeekToRun,
    editedBy,
    editedField,
    filters,
    frequency,
    handleClose,
    hasEndAt,
    hasStartAt,
    location,
    navigate,
    needsDayOfMonthSelection,
    needsWeekdaySelection,
    replaceText,
    requiresTime,
    searchKey,
    startDate,
    startTime,
    endDate,
    endTime,
    supportValue,
    timeToRun,
    timezone,
    title,
    validate,
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
        onClose={handleClose}
        title={t("recurringEditModalTitle")}
        primaryAction={{
          content: t("recurringEditSaveButton"),
          onAction: handleSubmit,
          loading: submitting,
          disabled: submitting,
        }}
        secondaryActions={[
          {
            content: t("commonCancelButton"),
            onAction: handleClose,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {upgradeWarning && (
              <Banner
                tone="warning"
                title={t("recurringEditUpgradeRequired")}
                onDismiss={() => setUpgradeWarning("")}
                action={{
                  content: t("recurringEditUpgradePlan"),
                  onAction: () => navigate("/pricing"),
                }}
              >
                <p>{upgradeWarning}</p>
              </Banner>
            )}

            {error && (
              <Banner tone="critical" onDismiss={() => setError("")}>
                <p>{error}</p>
              </Banner>
            )}

            <Banner tone="info">
              <p>
                {t("recurringEditDescriptionPrefix")} <strong>{count}</strong>{" "}
                {t("recurringEditDescriptionSuffix")}
              </p>
            </Banner>

            <FormLayout>
              <TextField
                label={t("recurringEditTitleLabel")}
                value={title}
                onChange={setTitle}
                autoComplete="off"
                placeholder={t("recurringEditTitlePlaceholder")}
              />

              <FormLayout.Group>
                <Select
                  label={t("recurringEditFrequencyLabel")}
                  options={FREQUENCY_OPTIONS.map((opt) => ({
                    ...opt,
                    label: t(`recurringEditFrequencyOptions.${opt.value}`),
                  }))}
                  value={frequency}
                  onChange={setFrequency}
                />
                <Select
                  label={t("recurringEditTimezoneLabel")}
                  options={TIMEZONE_OPTIONS.map((opt) => ({
                    ...opt,
                    label: t(`recurringEditTimezoneOptions.${opt.value}`),
                  }))}
                  value={timezone}
                  onChange={setTimezone}
                />
              </FormLayout.Group>

              {requiresTime && (
                <TextField
                  label={t("recurringEditTimeLabel")}
                  type="time"
                  value={timeToRun}
                  onChange={setTimeToRun}
                  helpText={t("recurringEditTimeHelpText")}
                />  
              )}

              {needsWeekdaySelection && (
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {t("recurringEditDaysOfWeekLabel")}
                  </Text>
                  <InlineStack gap="300" wrap>
                    {DAYS_OF_WEEK.map((day) => (
                      <Checkbox
                        key={day}
                        label={t(`weekdays.${day}`)}
                        checked={daysOfWeekToRun.includes(day)}
                        onChange={(checked) => handleWeekdayChange(day, checked)}
                      />
                    ))}
                  </InlineStack>
                </BlockStack>
              )}

              {needsDayOfMonthSelection && (
                <Select
                  label={t("recurringEditDayOfMonthLabel")}
                  options={dayOfMonthOptions}
                  value={dayOfMonthToRun}
                  onChange={setDayOfMonthToRun}
                  helpText={t("recurringEditDayOfMonthHelpText")}
                />
              )}

              <Checkbox
                label={t("recurringEditStartSpecificDateLabel")}
                checked={hasStartAt}
                onChange={(checked) => setHasStartAt(checked)}
              />

              {hasStartAt && (
                <FormLayout.Group>
                  <TextField
                    label={t("recurringEditStartDateLabel")}
                    type="date"
                    value={startDate}
                    onChange={setStartDate}
                    min={getCurrentDateInputValue()}
                  />
                  <TextField
                    label={t("recurringEditStartTimeLabel")}
                    type="time"
                    value={startTime}
                    onChange={setStartTime}
                  />
                </FormLayout.Group>
              )}

              <Checkbox
                label={t("recurringEditStopAfterDateLabel")}
                checked={hasEndAt}
                onChange={(checked) => setHasEndAt(checked)}
              />

              {hasEndAt && (
                <FormLayout.Group>
                  <TextField
                    label={t("recurringEditEndDateLabel")}
                    type="date"
                    value={endDate}
                    onChange={setEndDate}
                    min={startDate || getCurrentDateInputValue()}
                  />
                  <TextField
                    label={t("recurringEditEndTimeLabel")}
                    type="time"
                    value={endTime}
                    onChange={setEndTime}
                  />
                </FormLayout.Group>
              )}
            </FormLayout>
          </BlockStack>
        </Modal.Section>
      </Modal>
      {toastMarkup}
    </Frame>
  );
}

export default React.memo(RecurringEditModal);