import shopify from "../../shopify.js";

const METAOBJECT_LABEL_KEYS = [
  "label",
  "display_name",
  "name",
  "title",
  "value",
];

const METAOBJECT_QUERY = `
  query GetMetaobjectsByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Metaobject {
        id
        fields {
          key
          value
        }
      }
    }
  }
`;

const METAOBJECT_CHUNK_SIZE = 250;
const METAOBJECT_FETCH_CONCURRENCY = 2;

function isMetaobjectReferenceValue(value) {
  return /^gid:\/\/shopify\/Metaobject\/\d+$/.test(String(value || "").trim());
}

function getMetaobjectDisplayValue(node) {
  const fields = Array.isArray(node?.fields) ? node.fields : [];

  const preferredField = fields.find(
    (field) =>
      METAOBJECT_LABEL_KEYS.includes(field?.key) &&
      typeof field?.value === "string" &&
      field.value.trim().length > 0 &&
      !isMetaobjectReferenceValue(field.value),
  );

  if (preferredField?.value) {
    return preferredField.value.trim();
  }

  const firstNonEmptyField = fields.find(
    (field) =>
      typeof field?.value === "string" &&
      field.value.trim().length > 0 &&
      !isMetaobjectReferenceValue(field.value),
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
    console.warn("Failed to parse metaobject reference array");
    return [];
  }
}

export async function fetchMetaobjectLookupByIds(session, ids = []) {
  if (!session?.accessToken || !session?.shop || !Array.isArray(ids) || ids.length === 0) {
    return new Map();
  }

  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const client = new shopify.api.clients.Graphql({ session });
  const lookup = new Map();
  const chunks = [];

  for (let i = 0; i < uniqueIds.length; i += METAOBJECT_CHUNK_SIZE) {
    chunks.push(uniqueIds.slice(i, i + METAOBJECT_CHUNK_SIZE));
  }

  async function fetchChunk(chunk) {
    const response = await client.query({
      data: {
        query: METAOBJECT_QUERY,
        variables: { ids: chunk },
      },
    });

    const responseBody = response?.body;
    if (!responseBody || typeof responseBody !== "object") {
      throw new Error("Shopify metaobject lookup response was empty");
    }

    const topLevelErrors = Array.isArray(responseBody.errors)
      ? responseBody.errors
      : [];
    if (topLevelErrors.length > 0) {
      throw new Error(
        topLevelErrors.map((err) => err?.message).filter(Boolean).join(", "),
      );
    }

    const nodes = responseBody?.data?.nodes;
    if (!Array.isArray(nodes)) {
      throw new Error("Shopify metaobject lookup returned an invalid nodes payload");
    }

    for (const node of nodes) {
      if (!node) {
        console.warn("Metaobject lookup returned a null node");
        continue;
      }

      const label = getMetaobjectDisplayValue(node);

      if (node.id && label) {
        lookup.set(node.id, label);
      }
    }
  }

  for (let i = 0; i < chunks.length; i += METAOBJECT_FETCH_CONCURRENCY) {
    await Promise.all(
      chunks
        .slice(i, i + METAOBJECT_FETCH_CONCURRENCY)
        .map((chunk) => fetchChunk(chunk)),
    );
  }

  return lookup;
}

export async function fetchMetaobjectLookup(session, ids = []) {
  return fetchMetaobjectLookupByIds(session, ids);
}
