import React, { useState } from "react";
import { Page, Banner, BlockStack } from "@shopify/polaris";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  selectFilters,
  selectProductCount,
} from "../../../../store/slices/productSlice";
import { allFields } from "../constants";

import ExportSettingsCard from "../components/ExportSettingsCard";
import FieldSelectionCard from "../components/FieldSelectionCard";
import InfoCard from "../components/InfoCard";

export default function CsvExportPage() {
  const navigate = useNavigate();
  const count = useSelector(selectProductCount);
  const filters = useSelector(selectFilters);

  const [selectedFields, setSelectedFields] = useState([]);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState(null);

  const productFields = allFields.filter((f) => f.group === "product");
  const variantFields = allFields.filter((f) => f.group === "variant");
  const seoFields = allFields.filter((f) => f.group === "seo");

  const validateFileName = () => {
    if (!fileName.trim()) {
      setFileError("File name is required");
      return false;
    }

    if (!/^[a-zA-Z0-9-_ ]+$/.test(fileName)) {
      setFileError(
        "Only letters, numbers, spaces, dash and underscore allowed"
      );
      return false;
    }

    setFileError("");
    return true;
  };

  const handleExport = async () => {
    if (loading) return;
    if (!validateFileName()) return;
    if (selectedFields.length === 0) return;

    setLoading(true);
    setBanner(null);

    const payload = {
      shop: "demo-zen-store.myshopify.com",
      fields: selectedFields,
      fileName: fileName.endsWith(".csv")
        ? fileName
        : `${fileName}.csv`,
      filterParams: filters,
    };

    try {
      const res = await fetch("/api/products/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setBanner({
          tone: "critical",
          message: data.error || "Export failed",
        });
      } else {
        setBanner({
          tone: "success",
          message:
            "Export started successfully. You’ll receive the CSV once ready.",
        });
        navigate("/exportDetails/" + data.exportJobId);
      }
    } catch (err) {
      setBanner({
        tone: "critical",
        message: "Something went wrong while starting export.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Page
      title="Export products to CSV"
      subtitle="Download product and variant data for reporting or bulk editing"
      primaryAction={{
        content: loading ? "Exporting..." : "Generate CSV",
        onAction: handleExport,
        disabled:
          loading ||
          selectedFields.length === 0 ||
          !fileName.trim(),
      }}
      backAction={{
        onAction: () => navigate("/products"),
      }}
    >
      <BlockStack gap="400">

        {banner && (
          <Banner
            tone={banner.tone}
            onDismiss={() => setBanner(null)}
          >
            {banner.message}
          </Banner>
        )}

        <ExportSettingsCard
          fileName={fileName}
          setFileName={setFileName}
          fileError={fileError}
          validateFileName={validateFileName}
          count={count}
          loading={loading}
        />

        <FieldSelectionCard
          productFields={productFields}
          variantFields={variantFields}
          seoFields={seoFields}
          selectedFields={selectedFields}
          setSelectedFields={setSelectedFields}
          allFields={allFields}
          loading={loading}
        />

        <InfoCard />

      </BlockStack>
    </Page>
  );
}