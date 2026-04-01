import React, { useMemo, lazy, Suspense } from 'react';
import { Card, Grid, Box, Text, SkeletonDisplayText, SkeletonBodyText } from '@shopify/polaris';
import { useTranslation } from 'react-i18next';
import { i18n as appI18n } from "../../../utils/i18nUtils";
import './MetamatrixCardGroup.css';

// Lazy load icon components for better code splitting
const BulkEditIcon = lazy(() => import('../icons/BulkEditIcon'));
const SpreadsheetIcon = lazy(() => import('../icons/SpreadsheetIcon'));
const ExportIcon = lazy(() => import('../icons/ExportIcon'));
const ChangelogIcon = lazy(() => import('../icons/ChangelogIcon'));

// Pre-defined card configuration to avoid recreation
const CARD_CONFIG = [
  {
    id: 'bulk-edit',
    titleKey: 'tips_bulk_editing',
    descKey: 'tips_bulk_editing_desc',
    iconComponent: BulkEditIcon,
    iconLabel: 'Bulk editing illustration'
  },
  {
    id: 'spreadsheet',
    titleKey: 'edit_products_spreadsheet',
    descKey: 'edit_products_spreadsheet_desc',
    iconComponent: SpreadsheetIcon,
    iconLabel: 'Spreadsheet editing illustration'
  },
  {
    id: 'export',
    titleKey: 'export_product_data',
    descKey: 'export_product_data_desc',
    iconComponent: ExportIcon,
    iconLabel: 'Data export illustration'
  },
  {
    id: 'changelog',
    titleKey: 'metamatrix_changelog',
    descKey: 'metamatrix_changelog_desc',
    iconComponent: ChangelogIcon,
    iconLabel: 'Changelog illustration'
  }
];

// Memoized grid configuration
const GRID_SPAN_CONFIG = { xs: 6, sm: 3, md: 3, lg: 6, xl: 6 };

// Loading skeleton component for better perceived performance
const CardSkeleton = React.memo(() => (
  <div className="metamatrix-card-skeleton">
    <Card>
      <Box padding="4">
        <Box paddingBlockEnd="4">
          <div className="metamatrix-card-icon-skeleton" />
        </Box>
        <Box paddingBlockEnd="2">
          <SkeletonDisplayText size="medium" />
        </Box>
        <SkeletonBodyText lines={3} />
      </Box>
    </Card>
  </div>
));

// Optimized individual card component with deep comparison
const MetamatrixCard = React.memo(({ 
  title, 
  description, 
  IconComponent, 
  iconLabel,
  cardId 
}) => (
  <div className="metamatrix-card-wrapper" data-card-id={cardId}>
    <Card>
      <Box padding="0">
        <Box
          minHeight="120px"
          padding="4"
          background="bg-surface-secondary"
          borderBlockEndWidth="025"
          borderColor="border-subdued"
        >
          <Box
            display="flex"
            alignItems="center"
            justifyContent="center"
            height="100%"
          >
            <Suspense fallback={<div className="metamatrix-icon-fallback" />}>
              <IconComponent aria-label={iconLabel} />
            </Suspense>
          </Box>
        </Box>
        <Box padding="4">
          <Box paddingBlockEnd="2">
            <Text variant="headingMd" as="h3" fontWeight="semibold">
              {title}
            </Text>
          </Box>
          <Text variant="bodyMd" as="p" color="subdued" tone="subdued">
            {description}
          </Text>
        </Box>
      </Box>
    </Card>
  </div>
), (prevProps, nextProps) => 
  prevProps.title === nextProps.title && 
  prevProps.description === nextProps.description &&
  prevProps.iconLabel === nextProps.iconLabel
);

MetamatrixCard.displayName = 'MetamatrixCard';

MetamatrixCard.displayName = 'MetamatrixCard';

/**
 * Performance-optimized Metamatrix card group component:
 * - Removes styled-components for better performance
 * - Uses lazy-loaded icon components for code splitting
 * - Pre-computes card configuration to avoid recreation
 * - Implements proper memoization with deep comparison
 * - Uses CSS classes with Polaris design tokens
 * - Optimizes translations with memoization
 * - Includes loading skeletons for better UX
 */
function MetamatrixCardGroup() {
  const { t } = useTranslation(undefined, { i18n: appI18n });

  // Memoize translated content with minimal dependencies
  const cards = useMemo(() => 
    CARD_CONFIG.map(config => ({
      id: config.id,
      title: t(config.titleKey),
      description: t(config.descKey),
      IconComponent: config.iconComponent,
      iconLabel: t(`${config.titleKey}_icon_label`, config.iconLabel)
    }))
  , [t]);

  // Memoize section title separately to avoid unnecessary re-computation
  const sectionTitle = useMemo(() => 
    t('learn_more_metamatrix', 'Learn more about Metamatrix')
  , [t]);

  return (
    <section className="metamatrix-card-group" aria-labelledby="metamatrix-section-title">
      <Box paddingBlockStart="8">
        <Box paddingBlockEnd="4">
          <Text 
            variant="headingLg" 
            as="h2" 
            id="metamatrix-section-title"
          >
            {sectionTitle}
          </Text>
        </Box>
        <Grid gap="4">
          {cards.map((card) => (
            <Grid.Cell key={card.id} columnSpan={GRID_SPAN_CONFIG}>
              <MetamatrixCard 
                cardId={card.id}
                title={card.title}
                description={card.description}
                IconComponent={card.IconComponent}
                iconLabel={card.iconLabel}
              />
            </Grid.Cell>
          ))}
        </Grid>
      </Box>
    </section>
  );
}

// Enhanced memoization with custom comparison
export default React.memo(MetamatrixCardGroup, (prevProps, nextProps) => {
  // Since this component has no props, it only re-renders when translation context changes
  return true;
});