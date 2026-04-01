import { Modal, Banner, Text, Box } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { i18n as appI18n } from "../../../utils/i18nUtils";

export default function ConfirmImportModal({
    open,
    onClose,
    onConfirm,
    loading,
}) {
    const { t } = useTranslation(undefined, { i18n: appI18n });

    return (
        <Modal
            open={open}
            onClose={loading ? () => {} : onClose}
            title={t("spreadsheetConfirmTitle", { defaultValue: "Confirm Product Import" })}
            primaryAction={{
                content: t("spreadsheetConfirmPrimary", {
                    defaultValue: "Yes, Import Products",
                }),
                destructive: true,
                onAction: onConfirm,
                loading,
                disabled: loading,
            }}
            secondaryActions={[
                {
                    content: t("spreadsheetCancel", { defaultValue: "Cancel" }),
                    onAction: onClose,
                    disabled: loading,
                },
            ]}
        >
            <Modal.Section>
                <Text>
                    {t("spreadsheetConfirmMessage", {
                        defaultValue: "Are you sure you want to import this CSV?",
                    })}
                </Text>

                <Box paddingBlockStart="300">
                    <Banner tone="critical">
                        <p>
                            {t("spreadsheetConfirmBanner", {
                                defaultValue:
                                    "Products will be updated based on Product ID and Variant ID.",
                            })}
                        </p>
                    </Banner>
                </Box>
            </Modal.Section>
        </Modal>
    );
}
