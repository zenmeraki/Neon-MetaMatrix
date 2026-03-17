import React, { useState } from "react";
import Papa from "papaparse";
import {
  Page,
  Card,
  Text,
  Button,
  DropZone,
  Banner,
  BlockStack,
  InlineStack,
  Icon,
  Divider,
  Box,
  List,
  Select,
  DataTable,
} from "@shopify/polaris";
import {
  UploadIcon,
  FileIcon,
  CheckCircleIcon,
  AlertCircleIcon,
} from "@shopify/polaris-icons";
import { useNavigate } from "react-router-dom";

export default function Spreadsheet() {
  const navigate = useNavigate()
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState(null);
  const [parsedData, setParsedData] = useState([]);
  const [columnMappings, setColumnMappings] = useState({});

  // 🔹 SAME FIELDS AS BEFORE
  const productFields = [
    { label: "Ignore this field", value: "" },

    // 🔑 Required identifiers
    { label: "Product ID", value: "id" },
    { label: "Variant ID", value: "variant_id" },

    // 🧾 Product fields
    { label: "Title", value: "title" },
    { label: "Description", value: "description" },
    { label: "Vendor", value: "vendor" },
    { label: "Product Type", value: "productType" },
    { label: "Handle", value: "handle" },
    { label: "Status", value: "status" },
    { label: "Tags", value: "tags" },
    { label: "Collections", value: "collections" },
    { label: "Category", value: "category" },

    // 🔍 SEO
    { label: "SEO Meta Title", value: "metaTitle" },
    { label: "SEO Meta Description", value: "metaDescription" },

    // 🎛 Options (product-level)
    { label: "Option 1 Name", value: "option1Name" },
    { label: "Option 2 Name", value: "option2Name" },
    { label: "Option 3 Name", value: "option3Name" },

    // 🧬 Variant fields
    { label: "Price", value: "price" },
    { label: "Compare At Price", value: "compareAtPrice" },
    { label: "SKU", value: "sku" },
    { label: "Barcode", value: "barcode" },
    { label: "Taxable", value: "taxable" },

    // 🎚 Variant options
    { label: "Option 1 Values", value: "option1Values" },
    { label: "Option 2 Values", value: "option2Values" },
    { label: "Option 3 Values", value: "option3Values" },
  ];

  // 🔹 DROPZONE (UNCHANGED DESIGN)
  const handleDrop = (_dropFiles, acceptedFiles) => {
    const selectedFile = acceptedFiles[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setStatus(null);

    Papa.parse(selectedFile, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false, // 🔥 Prevent automatic number conversion

      transform: (value) => {
        if (value === null || value === undefined) return "";
        return String(value).trim(); // Force string
      },

      complete: (results) => {
        if (!results.data?.length) {
          setStatus({
            type: "error",
            message: "CSV file is empty.",
          });
          return;
        }

        // 🔥 Normalize IDs (fix scientific notation)
        const safeData = results.data.map((row) => {
          const newRow = {};

          Object.keys(row).forEach((key) => {
            let val = row[key];

            if (!val) {
              newRow[key] = "";
              return;
            }

            const lowerKey = key.toLowerCase();

            // If column is ID-related → protect it
            if (
              lowerKey.includes("id") ||
              lowerKey.includes("variant")
            ) {
              // Fix scientific notation like 8.74305E+12
              if (typeof val === "string" && val.includes("E+")) {
                val = Number(val).toFixed(0);
              }

              newRow[key] = String(val);
            } else {
              newRow[key] = val;
            }
          });

          return newRow;
        });

        setParsedData(safeData);

        // 🔥 SAME AUTO-MAP LOGIC (using safeData instead of results.data)
        const initialMappings = {};
        Object.keys(safeData[0]).forEach((header) => {
          const lower = header.toLowerCase().trim();

          if (["id", "productid"].includes(lower))
            initialMappings[header] = "id";
          else if (["variantid", "variant_id"].includes(lower))
            initialMappings[header] = "variant_id";
          else if (lower.includes("metatitle"))
            initialMappings[header] = "metaTitle";
          else if (lower.includes("metadescription"))
            initialMappings[header] = "metaDescription";
          else if (lower.includes("title"))
            initialMappings[header] = "title";
          else if (lower.includes("sku"))
            initialMappings[header] = "sku";
          else if (lower.includes("1name"))
            initialMappings[header] = "option1Name";
          else if (lower.includes("2name"))
            initialMappings[header] = "option2Name";
          else if (lower.includes("3name"))
            initialMappings[header] = "option3Name";
          else if (lower.includes("compareatprice"))
            initialMappings[header] = "compareAtPrice";
          else if (lower.includes("price"))
            initialMappings[header] = "price";
          else if (lower.includes("barcode") || lower.includes("upc"))
            initialMappings[header] = "barcode";
          else if (lower.includes("vendor") || lower.includes("brand"))
            initialMappings[header] = "vendor";
          else if (lower.includes("status"))
            initialMappings[header] = "status";
          else if (lower.includes("description"))
            initialMappings[header] = "description";
          else if (lower.includes("handle"))
            initialMappings[header] = "handle";
          else if (lower.includes("type"))
            initialMappings[header] = "productType";
          else if (lower.includes("taxable"))
            initialMappings[header] = "taxable";
          else if (lower.includes("category"))
            initialMappings[header] = "category";
          else if (lower.includes("collections"))
            initialMappings[header] = "collections";
          else if (lower.includes("tags"))
            initialMappings[header] = "tags";
          else
            initialMappings[header] = "";
        });

        setColumnMappings(initialMappings);
      },

      error: (error) =>
        setStatus({
          type: "error",
          message: `CSV parsing failed: ${error.message}`,
        }),
    });
  };

  const handleColumnMappingChange = (csvColumn, mappedField) => {
    setColumnMappings((prev) => ({ ...prev, [csvColumn]: mappedField }));
  };

  // 🔥 UPLOAD ORIGINAL FILE (NO CSV TRANSFORM)
  const handleUpload = async () => {
    if (!file) {
      setStatus({ type: "error", message: "Please select a CSV file first." });
      return;
    }

    if (!Object.values(columnMappings).some(Boolean)) {
      setStatus({
        type: "error",
        message: "Please map at least one column.",
      });
      return;
    }

    const firstHeader = Object.keys(parsedData[0])[0];
    if (columnMappings[firstHeader] !== "id") {
      setStatus({
        type: "error",
        message: "Product ID must be the first column.",
      });
      return;
    }

    const hasPrice = Object.values(columnMappings).includes("price");
    const hasBarcode = Object.values(columnMappings).includes("barcode");
    const hasVariantId = Object.values(columnMappings).includes("variant_id");

    if ((hasPrice || hasBarcode) && !hasVariantId) {
      setStatus({
        type: "error",
        message:
          "Variant ID is required when importing Price or Barcode fields.",
      });
      return;
    }

    try {
      setUploading(true);
      setStatus(null);

      const formData = new FormData();
      formData.append("file", file); // ✅ SAME FILE
      formData.append("columnMappings", JSON.stringify(columnMappings));

      const res = await fetch("/api/products/csv/import", {
        method: "POST",
        body: formData,
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.message || "Import failed");

      setStatus({
        type: "success",
        message: "Import queued successfully. Check edit history.",
      });
      navigate("/history")
      setFile(null);
      setParsedData([]);
      setColumnMappings({});
    } catch (err) {
      setStatus({ type: "error", message: err.message });
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveFile = () => {
    setFile(null);
    setParsedData([]);
    setColumnMappings({});
    setStatus(null);
  };

  // 🔹 SAME TABLE — ONLY CHANGE = slice(0, 50)
  const previewTable = parsedData.length > 0 && (
    <Card>
      <BlockStack gap="300">
        <Text variant="headingSm">Preview & Map Columns</Text>

        <DataTable
          columnContentTypes={Object.keys(parsedData[0]).map(() => "text")}
          headings={Object.keys(parsedData[0]).map((header) => (
            <Select
              label={header}
              labelHidden
              options={productFields}
              value={columnMappings[header] || ""}
              onChange={(value) => handleColumnMappingChange(header, value)}
            />
          ))}
          rows={parsedData
            .slice(0, 50)
            .map((row) => Object.values(row).map((val) => val || ""))}
        />

        <InlineStack align="space-between">
          <Text tone="subdued" variant="bodySm">
            {parsedData.length} rows loaded{" "}
            {parsedData.length > 50 && "(showing first 50)"}
          </Text>
          <Text tone="subdued" variant="bodySm">
            {Object.values(columnMappings).filter(Boolean).length} columns
            mapped
          </Text>
        </InlineStack>
      </BlockStack>
    </Card>
  );

  // 🔹 PAGE (100% SAME DESIGN)
  return (
    <Page
      title="Import Products"
      subtitle="Upload a CSV file to bulk update your product catalog"
      fullWidth
    >
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd">Upload CSV File</Text>

            <DropZone
              allowMultiple={false}
              onDrop={handleDrop}
              accept=".csv"
              type="file"
            >
              {!file && (
                <Box padding="600">
                  <BlockStack align="center" gap="200">
                    <Icon source={UploadIcon} />
                    <Text>Drag & drop CSV file or click to upload</Text>
                  </BlockStack>
                </Box>
              )}

              {file && (
                <Box padding="400">
                  <InlineStack align="space-between">
                    <InlineStack gap="300">
                      <Icon source={FileIcon} />
                      <Text>{file.name}</Text>
                    </InlineStack>
                    <Button plain onClick={handleRemoveFile}>
                      Remove
                    </Button>
                  </InlineStack>
                </Box>
              )}
            </DropZone>

            {previewTable}

            {status && (
              <Banner
                tone={status.type === "success" ? "success" : "critical"}
                icon={
                  status.type === "success" ? CheckCircleIcon : AlertCircleIcon
                }
              >
                <p>{status.message}</p>
              </Banner>
            )}

            <InlineStack align="end">
              <Button
                variant="primary"
                onClick={handleUpload}
                loading={uploading}
                disabled={!file || uploading}
              >
                Import Products
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
