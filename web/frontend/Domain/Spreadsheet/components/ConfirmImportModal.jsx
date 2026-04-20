import { Modal, Banner, Text, Box } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

export default function ConfirmImportModal({
    open,
    onClose,
    onConfirm,
    loading,
}) {
    const { t } = useTranslation();

    return (
        <Modal
            open={open}
            onClose={loading ? () => {} : onClose}
            title={t("spreadsheetConfirmTitle")}
            primaryAction={{
                content: t("spreadsheetConfirmPrimary"),
                destructive: true,
                onAction: onConfirm,
                loading,
                disabled: loading,
            }}
            secondaryActions={[
                {
                    content: t("cancel", { defaultValue: "Cancel" }),
                    onAction: onClose,
                    disabled: loading,
                },
            ]}
        >
            <Modal.Section>
                <Text>
                    {t("spreadsheetConfirmMessage")}
                </Text>

                <Box paddingBlockStart="300">
                    <Banner tone="critical">
                        <p>
                            {t("spreadsheetConfirmBanner")}
                        </p>
                    </Banner>
                </Box>
            </Modal.Section>
        </Modal>
    );
}
