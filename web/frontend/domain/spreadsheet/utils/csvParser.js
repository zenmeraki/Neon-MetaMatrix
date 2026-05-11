import Papa from "papaparse";

const PREVIEW_ROW_LIMIT = 50;
const MAX_PREVIEW_ERRORS = 20;

const FIELD_ALIASES = {
  id: new Set(["id", "product_id", "productid", "shopify_product_id"]),
  variant_id: new Set(["variant_id", "variantid", "shopify_variant_id"]),
  metaTitle: new Set(["meta_title", "metatitle", "seo_title"]),
  metaDescription: new Set(["meta_description", "metadescription", "seo_description"]),
  title: new Set(["title", "product_title", "producttitle"]),
  sku: new Set(["sku", "variant_sku"]),
  compareAtPrice: new Set(["compare_at_price", "compareatprice"]),
  price: new Set(["price", "variant_price"]),
  barcode: new Set(["barcode", "upc", "variant_barcode"]),
  vendor: new Set(["vendor", "brand"]),
  status: new Set(["status", "product_status"]),
  description: new Set(["description", "description_html", "body_html"]),
  handle: new Set(["handle", "product_handle"]),
  productType: new Set(["product_type", "producttype"]),
  taxable: new Set(["taxable"]),
  tags: new Set(["tags", "product_tags"]),
};

function normalizeHeader(header) {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, "")
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
}

function inferField(header) {
  const normalized = normalizeHeader(header);

  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.has(normalized)) return field;
  }

  return "";
}

function sanitizeCell(value) {
  if (value === null || value === undefined) return "";

  const text = String(value).trim();

  if (/^[=+\-@]/.test(text)) {
    return `'${text}`;
  }

  return text;
}

function buildInitialMappings(headers) {
  return headers.reduce((acc, header) => {
    acc[header] = inferField(header);
    return acc;
  }, {});
}

function findDuplicateHeaders(headers) {
  const seen = new Set();
  const duplicates = new Set();

  headers.forEach((header) => {
    const normalized = normalizeHeader(header);
    if (seen.has(normalized)) duplicates.add(header);
    seen.add(normalized);
  });

  return Array.from(duplicates);
}

export function parseCSV(file, setParsedData, setColumnMappings, setStatus, t) {
  const previewRows = [];
  let headers = [];
  let totalRows = 0;
  const parseErrors = [];

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    worker: true,

    transformHeader: (header) => String(header || "").trim().replace(/^\uFEFF/, ""),

    transform: sanitizeCell,

    step: (results, parser) => {
      if (!headers.length && Array.isArray(results.meta?.fields)) {
        headers = results.meta.fields;

        const duplicates = findDuplicateHeaders(headers);
        if (duplicates.length) {
          parser.abort();
          setStatus({
            type: "error",
            message: t("spreadsheetDuplicateHeaders", {
              defaultValue: `Duplicate CSV headers found: ${duplicates.join(", ")}`,
            }),
          });
          return;
        }

        setColumnMappings(buildInitialMappings(headers));
      }

      if (results.errors?.length) {
        parseErrors.push(...results.errors.slice(0, MAX_PREVIEW_ERRORS));
      }

      totalRows += 1;

      if (previewRows.length < PREVIEW_ROW_LIMIT) {
        const row = {};

        headers.forEach((header) => {
          row[header] = sanitizeCell(results.data?.[header]);
        });

        previewRows.push(row);
      }

      if (previewRows.length >= PREVIEW_ROW_LIMIT && totalRows > PREVIEW_ROW_LIMIT) {
        parser.abort();
      }
    },

    complete: () => {
      if (!previewRows.length) {
        setStatus({
          type: "error",
          message: t("spreadsheetEmptyCsv", {
            defaultValue: "CSV file is empty.",
          }),
        });
        return;
      }

      setParsedData(previewRows);

      if (parseErrors.length) {
        setStatus({
          type: "warning",
          message: t("spreadsheetPreviewParseWarnings", {
            defaultValue: "Preview loaded with CSV warnings. Full validation will run after upload.",
          }),
        });
        return;
      }

      setStatus({
        type: "success",
        message: t("spreadsheetPreviewReady", {
          defaultValue: "CSV preview loaded. Full validation will run after upload.",
        }),
      });
    },

    error: (error) => {
      setStatus({
        type: "error",
        message: t("spreadsheetParsingFailed", {
          defaultValue: "CSV parsing failed: {{message}}",
          message: error.message,
        }),
      });
    },
  });
}
