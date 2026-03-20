import { Modal, Banner, Text, Box } from "@shopify/polaris";

export default function ConfirmImportModal({
    open,
    onClose,
    onConfirm,
    loading,
}) {
    return (
        <Modal
            open={open}
            onClose={loading ? () => { } : onClose} // ✅ prevent close while loading
            title="Confirm Product Import"
            primaryAction={{
                content: "Yes, Import Products",
                destructive: true,
                onAction: onConfirm,
                loading,
                disabled: loading,
            }}
            secondaryActions={[
                {
                    content: "Cancel",
                    onAction: onClose,
                    disabled: loading, // ✅ disable cancel while uploading
                },
            ]}
        >
            <Modal.Section>
                <Text>Are you sure you want to import this CSV?</Text>

                <Box paddingBlockStart="300">
                    <Banner tone="critical">
                        <p>Products will be updated based on Product ID and Variant ID.</p>
                    </Banner>
                </Box>
            </Modal.Section>
        </Modal>
    );
}