import React from "react";
import { Card, BlockStack, Text, TextField } from "@shopify/polaris";

export default function ExportSettingsCard({
    fileName,
    setFileName,
    fileError,
    validateFileName,
    count,
    loading,
}) {
    return (
        <Card>
            <BlockStack gap="300">
                <Text variant="headingSm">Export Settings</Text>

                <TextField
                    label="File Name"
                    value={fileName}
                    onChange={(value) => {
                        setFileName(value);
                        if (fileError) validateFileName();
                    }}
                    autoComplete="off"
                    placeholder="e.g. january-products"
                    helpText="File will be downloaded as .csv"
                    error={fileError}
                    disabled={loading}
                />

                <Text tone="info">
                    You are about to export{" "}
                    <strong>{count == 0 ? "whole" : count}</strong> products.
                </Text>
            </BlockStack>
        </Card>
    );
}
