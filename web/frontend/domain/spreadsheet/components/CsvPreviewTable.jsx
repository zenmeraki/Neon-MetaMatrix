import {
  Card,
  Text,
  Select,
  IndexTable,
  BlockStack,
  InlineStack,
  Banner,
  Box,
} from "@shopify/polaris";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getProductFields } from "../constants";

const PREVIEW_ROW_LIMIT = 50;
const REQUIRED_FIELDS = ["id", "variant_id"];

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
}

function inferRequiredMapping(headers) {
  const normalized = headers.map((header) => ({
    raw: header,
    normalized: normalizeHeader(header),
  }));

  const idHeader = normalized.find((h) =>
    ["id", "product_id", "shopify_product_id"].includes(h.normalized)
  );

  const variantIdHeader = normalized.find((h) =>
    ["variant_id", "shopify_variant_id", "variantid"].includes(h.normalized)
  );

  return {
    [idHeader?.raw || ""]: idHeader ? "id" : "",
    [variantIdHeader?.raw || ""]: variantIdHeader ? "variant_id" : "",
  };
}

export default function CsvPreviewTable({
  parsedData,
  columnMappings,
  onMappingChange,
  totalRows = null,
}) {
  const { t } = useTranslation();
  const productFields = getProductFields(t);

  const previewRows = Array.isArray(parsedData)
    ? parsedData.slice(0, PREVIEW_ROW_LIMIT)
    : [];

  const headers = useMemo(
    () => (previewRows.length ? Object.keys(previewRows[0]) : []),
    [previewRows]
  );

  const inferredRequiredMappings = useMemo(
    () => inferRequiredMapping(headers),
    [headers]
  );

  const effectiveMappings = useMemo(
    () => ({
      ...inferredRequiredMappings,
      ...columnMappings,
    }),
    [columnMappings, inferredRequiredMappings]
  );

  const mappedValues = Object.values(effectiveMappings).filter(Boolean);

  const duplicateMappedFields = mappedValues.filter(
    (value, index) => mappedValues.indexOf(value) !== index
  );

  const missingRequiredFields = REQUIRED_FIELDS.filter(
    (field) => !mappedValues.includes(field)
  );

  if (!previewRows.length) return null;

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h3" variant="headingSm">
          {t("spreadsheetPreviewMapColumns", {
            defaultValue: "Map CSV columns",
          })}
        </Text>

        {missingRequiredFields.length ? (
          <Banner tone="critical">
            <Text as="p">
              {t("spreadsheetMissingRequiredMappings", {
                defaultValue:
                  "Required ID columns were not detected. Map product ID and variant ID before importing.",
              })}
            </Text>
          </Banner>
        ) : null}

        {duplicateMappedFields.length ? (
          <Banner tone="critical">
            <Text as="p">
              {t("spreadsheetDuplicateMappings", {
                defaultValue:
                  "Two or more CSV columns are mapped to the same product field. Fix duplicate mappings before importing.",
              })}
            </Text>
          </Banner>
        ) : null}

        <IndexTable
          resourceName={{
            singular: t("spreadsheetPreviewRow", { defaultValue: "row" }),
            plural: t("spreadsheetPreviewRows", { defaultValue: "rows" }),
          }}
          itemCount={previewRows.length}
          selectable={false}
          headings={headers.map((header) => ({
            id: header,
            title: (
              <Select
                label={header}
                labelHidden
                options={productFields}
                value={effectiveMappings[header] || ""}
                onChange={(value) => onMappingChange(header, value)}
              />
            ),
          }))}
        >
          {previewRows.map((row, rowIndex) => (
            <IndexTable.Row
              id={`csv-preview-${rowIndex}`}
              key={`csv-preview-${rowIndex}`}
              position={rowIndex}
            >
              {headers.map((header) => (
                <IndexTable.Cell key={`${rowIndex}-${header}`}>
                  <Box maxWidth="240px">
                    <Text as="span" truncate>
                      {String(row?.[header] ?? "")}
                    </Text>
                  </Box>
                </IndexTable.Cell>
              ))}
            </IndexTable.Row>
          ))}
        </IndexTable>

        <InlineStack align="space-between">
          <Text as="p" tone="subdued">
            {t("spreadsheetRowsLoaded", {
              defaultValue: "{{count}} preview rows shown",
              count: previewRows.length,
            })}
            {totalRows != null
              ? ` / ${Number(totalRows).toLocaleString()} total`
              : ""}
          </Text>

          <Text as="p" tone="subdued">
            {t("spreadsheetColumnsMapped", {
              defaultValue: "{{count}} columns mapped",
              count: mappedValues.length,
            })}
          </Text>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
