//web/utils/webhookTransformers.js

export const transformWebhookPayload = (payload, shop) => {
  const transformed = {
    // ✅ DON'T include shop and id - they're passed separately in the worker
    title: payload.title,
    handle: payload.handle,

    status: mapStatus(payload.status),

    productType: payload.product_type || null,
    vendor: payload.vendor || null,
    tags: payload.tags ? payload.tags.split(", ") : [],
    templateSuffix: payload.template_suffix || null,

    description: payload.body_html || null,

    createdAt: payload.created_at ? new Date(payload.created_at) : null,
    updatedAt: payload.updated_at ? new Date(payload.updated_at) : new Date(),
    publishedAt: payload.published_at ? new Date(payload.published_at) : null,

    totalInventory: calculateTotalInventory(payload.variants),

    // ✅ FIX: Store options and collections as JSON (not nested objects)
    optionsJson: transformOptions(payload.options),
    collectionsJson: [], // Webhooks don't include collections

    // ✅ FIX: Flatten category to separate fields
    categoryId: payload.category?.admin_graphql_api_id || null,
    categoryName: payload.category?.name || null,

    // ✅ FIX: Flatten featured image to separate fields
    featuredImageUrl: payload.image?.src || null,
    featuredImageAltText: payload.image?.alt || null,

    // SEO fields (not in webhook payload, set to null)
    seoTitle: null,
    seoDescription: null,
  };

  return transformed;
};

/**
 * Strip HTML tags from text
 */
const stripHtmlTags = (html) => {
  if (!html) return "";

  return html
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .replace(/&nbsp;/g, " ") // Replace &nbsp; with space
    .replace(/&amp;/g, "&") // Replace &amp; with &
    .replace(/&lt;/g, "<") // Replace &lt; with <
    .replace(/&gt;/g, ">") // Replace &gt; with >
    .replace(/&quot;/g, '"') // Replace &quot; with "
    .replace(/&#39;/g, "'") // Replace &#39; with '
    .replace(/\s+/g, " ") // Replace multiple spaces with single space
    .trim(); // Trim leading/trailing spaces
};

/**
 * Map REST status to GraphQL enum
 */
const mapStatus = (status) => {
  const statusMap = {
    active: "ACTIVE",
    archived: "ARCHIVED",
    draft: "DRAFT",
  };
  return statusMap[status?.toLowerCase()] || "DRAFT";
};

/**
 * Calculate total inventory from variants
 */
const calculateTotalInventory = (variants = []) => {
  return variants.reduce((total, variant) => {
    return total + (variant.inventory_quantity || 0);
  }, 0);
};

/**
 * Transform product options to match Prisma JSON format
 */
const transformOptions = (options = []) => {
  if (!options || options.length === 0) return [];

  return options.map((option, index) => ({
    id: `gid://shopify/ProductOption/${option.id}`,
    name: option.name,
    position: option.position || index + 1,
    values: option.values || [],
  }));
};

/**
 * Transform variants - ONLY USE THIS if storing variants separately
 * For webhook updates, variants are usually handled in bulk sync, not individual updates
 */
const transformVariants = (variants = [], options = []) => {
  if (!variants || variants.length === 0) return [];

  return variants.map((variant, index) => ({
    id: variant.admin_graphql_api_id,
    title: variant.title,
    sku: variant.sku || "",
    barcode: variant.barcode || "",

    price: parseFloat(variant.price) || 0,
    compareAtPrice: variant.compare_at_price ? parseFloat(variant.compare_at_price) : null,

    inventoryQuantity: variant.inventory_quantity || 0,
    inventoryPolicy:
      variant.inventory_policy === "continue" ? "CONTINUE" : "DENY",

    taxable: variant.taxable || false,
    taxCode: variant.tax_code || "",

    position: variant.position || index + 1,

    selectedOptions: transformSelectedOptions(variant, options),
  }));
};

/**
 * Transform variant selected options
 */
const transformSelectedOptions = (variant = {}, options = []) => {
  return options
    .map((option, index) => {
      const value = variant[`option${index + 1}`];

      if (!value) return null;

      return {
        name: option?.name || `Option${index + 1}`,
        value,
      };
    })
    .filter(Boolean);
};

/**
 * Extract variants for Prisma Variant model (if needed)
 * Use this if you want to store variants in the separate Variant table
 */
export const extractVariantsForPrisma = (payload, productId, shop) => {
  if (!payload.variants || !Array.isArray(payload.variants)) {
    return [];
  }

  const options = payload.options || [];
  
  return payload.variants.map((variant, index) => ({
    shop,
    id: variant.admin_graphql_api_id,
    productId,
    title: variant.title,
    sku: variant.sku || null,
    barcode: variant.barcode || null,
    price: variant.price ? parseFloat(variant.price) : null,
    compareAtPrice: variant.compare_at_price ? parseFloat(variant.compare_at_price) : null,
    inventoryQuantity: variant.inventory_quantity || 0,
    inventoryPolicy: variant.inventory_policy === "continue" ? "CONTINUE" : "DENY",
    taxable: variant.taxable || false,
    taxCode: variant.tax_code || null,
    position: variant.position || index + 1,
    selectedOptionsJson: transformSelectedOptions(variant, options),
  }));
};