import shopify from "../../shopify.js";

const METAOBJECT_LABEL_KEYS = [
  "label",
  "name",
  "title",
  "value",
  "display_name",
];

function getMetaobjectDisplayValue(node) {
  const fields = Array.isArray(node?.fields) ? node.fields : [];

  const preferredField = fields.find(
    (field) =>
      METAOBJECT_LABEL_KEYS.includes(field?.key) &&
      typeof field?.value === "string" &&
      field.value.trim().length > 0 &&
      !field.value.includes("gid://shopify/Metaobject/"),
  );

  if (preferredField?.value) {
    return preferredField.value.trim();
  }

  const firstNonEmptyField = fields.find(
    (field) =>
      typeof field?.value === "string" &&
      field.value.trim().length > 0 &&
      !field.value.includes("gid://shopify/Metaobject/"),
  );

  return firstNonEmptyField?.value?.trim() || null;
}

export function extractMetaobjectIds(rawValue) {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return [];
  }

  const normalized = rawValue.trim();

  if (normalized.startsWith("gid://shopify/Metaobject/")) {
    return [normalized];
  }

  try {
    const parsed = JSON.parse(normalized);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (value) =>
        typeof value === "string" &&
        value.startsWith("gid://shopify/Metaobject/"),
    );
  } catch {
    return [];
  }
}

export async function fetchMetaobjectLookupByIds(session, ids = []) {
  if (!session?.accessToken || !Array.isArray(ids) || ids.length === 0) {
    return new Map();
  }

  const client = new shopify.api.clients.Graphql({ session });
  const lookup = new Map();
  const chunkSize = 100;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);

    const query = `
      query GetMetaobjectsByIds($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Metaobject {
            id
            fields { key value }
          }
        }
      }
    `;

    const response = await client.query({
      data: {
        query,
        variables: { ids: chunk },
      },
    });

    const nodes = response.body?.data?.nodes || [];

    for (const node of nodes) {
      const label = getMetaobjectDisplayValue(node);

      if (node?.id && label) {
        lookup.set(node.id, label);
      }
    }
  }

  return lookup;
}

export async function fetchMetaobjectLookup(session, ids = []) {
  return fetchMetaobjectLookupByIds(session, ids);
}