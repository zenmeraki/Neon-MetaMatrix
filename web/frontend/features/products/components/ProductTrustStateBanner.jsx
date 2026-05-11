import { Banner, Layout, List } from "@shopify/polaris";

export default function ProductTrustStateBanner({ t, trustMetadata }) {
  return (
    <Layout.Section>
      <Banner tone="info" title={t("targetingTrustState", { defaultValue: "Targeting trust state" })}>
        <List>
          <List.Item>{`Snapshot ID: ${trustMetadata.snapshotId}`}</List.Item>
          <List.Item>{`Mirror batch ID: ${trustMetadata.mirrorBatchId}`}</List.Item>
          <List.Item>{`Variant freshness: ${trustMetadata.variantFreshness}`}</List.Item>
          <List.Item>{`Collection freshness: ${trustMetadata.collectionFreshness}`}</List.Item>
          <List.Item>{`Metafield freshness: ${trustMetadata.metafieldFreshness}`}</List.Item>
        </List>
      </Banner>
    </Layout.Section>
  );
}
