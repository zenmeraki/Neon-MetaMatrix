import { Layout } from "@shopify/polaris";
import SelectionCommandBar from "../../../domain/products/list/components/SelectionCommandBar";

export default function ProductSelectionActionsSection({
  hasSelection,
  selection,
  totalCount,
  targetAction,
  onEdit,
  onExport,
  onViewSelection,
  onNarrowSelection,
  onSaveSegment,
}) {
  if (!hasSelection) return null;

  return (
    <Layout.Section>
      <SelectionCommandBar
        selection={selection}
        totalCount={totalCount}
        targetAction={targetAction}
        onEdit={onEdit}
        onExport={onExport}
        onViewSelection={onViewSelection}
        onNarrowSelection={onNarrowSelection}
        onSaveSegment={onSaveSegment}
      />
    </Layout.Section>
  );
}
