// web/frontend/hooks/useTinyTranslate.js
import { useCallback } from "react";

const STRINGS = Object.freeze({
  learn_more_metamatrix: "Learn more about Metamatrix",

  tips_bulk_editing: "Bulk editing tips",
  tips_bulk_editing_desc: "Learn how to efficiently edit multiple products.",

  edit_products_spreadsheet: "Edit via spreadsheet",
  edit_products_spreadsheet_desc: "Upload a CSV to update products in bulk.",

  export_product_data: "Export product data",
  export_product_data_desc: "Download all store product details easily.",

  metamatrix_changelog: "Metamatrix changelog",
  metamatrix_changelog_desc: "See what was updated recently.",
});

export default function useTinyTranslate() {
  return useCallback((key) => STRINGS[key] || key, []);
}
