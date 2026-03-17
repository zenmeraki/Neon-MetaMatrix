import React, { memo, useState, useCallback } from "react";
import {
  TextField,
  Button,
  InlineStack,
  Modal,
  ChoiceList,
  DatePicker,
  Box
} from "@shopify/polaris";
import { t } from "i18next";
// import { FilterIcon, SaveIcon, ExportIcon } from "@shopify/polaris-icons";

interface DateRange {
  start: Date;
  end: Date;
}

interface AdvancedFilters {
  status: string[];
  dateRange: DateRange;
}

interface HistoryFiltersProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  onAdvancedFilter: (filters: AdvancedFilters) => void;
  onExport: () => void;
  onSaveView: () => void;
  open: boolean;
  onClose: () => void;
}

const HistoryFilters = memo<HistoryFiltersProps>(({
  searchValue,
  onSearchChange,
  onAdvancedFilter,
  onExport,
  onSaveView,
  open,
  onClose
}) => {
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>({
    status: [],
    dateRange: {
      start: new Date(new Date().setDate(new Date().getDate() - 30)),
      end: new Date()
    }
  });

  const handleStatusChange = useCallback((value: string[]) => {
    setAdvancedFilters((prev) => ({
      ...prev,
      status: value
    }));
  }, []);

  const handleDateChange = useCallback((range: DateRange) => {
    setAdvancedFilters((prev) => ({
      ...prev,
      dateRange: range
    }));
  }, []);

  const applyAdvancedFilters = useCallback(() => {
    onAdvancedFilter(advancedFilters);
    onClose();
  }, [onAdvancedFilter, advancedFilters, onClose]);

  return (
    <>
      <InlineStack  align="start">
        <div style={{ flex: 1 }}>
          <TextField
            label="Search"
            labelHidden
            placeholder={t("searchHistory")}
            value={searchValue}
            onChange={onSearchChange}
            clearButton
            onClearButtonClick={() => onSearchChange('')}
            autoComplete="off"
          />
        </div>
      </InlineStack>

      <Modal
        open={open}
        onClose={onClose}
        title="Advanced Filters"
        primaryAction={{
          content: "Apply Filters",
          onAction: applyAdvancedFilters
        }}
        secondaryActions={[
          {
            content:t("cancel"),
            onAction: onClose
          }
        ]}
      >
        <Modal.Section>
          <ChoiceList
            title="Status"
            choices={[
              { label: 'Complete', value: 'Complete' },
              { label: 'Running', value: 'Running' },
              { label: 'Scheduled', value: 'Scheduled' },
              { label: 'Cancelled', value: 'Cancelled' },
              { label: 'Failed', value: 'Failed' }
            ]}
            selected={advancedFilters.status}
            onChange={handleStatusChange}
            allowMultiple
          />

          <Box >
            <DatePicker
              month={advancedFilters.dateRange.start.getMonth()}
              year={advancedFilters.dateRange.start.getFullYear()}
              onChange={handleDateChange}
              selected={advancedFilters.dateRange}
              multiMonth
              allowRange
            />
          </Box>
        </Modal.Section>
      </Modal>
    </>
  );
});

HistoryFilters.displayName = 'HistoryFilters';

export default HistoryFilters;