import shopify from "../../shopify.js";
import { getCache, setCache } from "../../utils/cacheUtils.js";
import { adminGraphqlWithRetry } from "../../utils/shopifyAdminApi.js";

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

export async function fetchMetaobjectLookupByIdsDetailed(
  session,
  ids = [],
  { bestEffort = false } = {},
) {
  if (!session?.accessToken || !Array.isArray(ids) || ids.length === 0) {
    return {
      lookup: new Map(),
      degraded: false,
      missingIds: [],
    };
  }

  const lookup = new Map();
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const uncachedIds = [];
  const chunkSize = 100;

  for (const id of uniqueIds) {
    const cached = await getCache(`${session.shop}:metaobject_label:${id}`);
    if (cached) {
      lookup.set(id, cached);
    } else {
      uncachedIds.push(id);
    }
  }

  let degraded = false;
  const missingIds = [];

  for (let i = 0; i < uncachedIds.length; i += chunkSize) {
    const chunk = uncachedIds.slice(i, i + chunkSize);

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

    try {
      const response = await adminGraphqlWithRetry({
        session,
        shop: session.shop,
        operationName: "metaobjectLookup.fetchByIds",
        data: {
          query,
          variables: { ids: chunk },
        },
      });

      const nodes = response.body?.data?.nodes || [];
      const resolvedIds = new Set();

      for (const node of nodes) {
        const label = getMetaobjectDisplayValue(node);

        if (node?.id) {
          resolvedIds.add(node.id);
        }

        if (node?.id && label) {
          lookup.set(node.id, label);
          await setCache(`${session.shop}:metaobject_label:${node.id}`, label, 24 * 3600);
        }
      }

      for (const id of chunk) {
        if (!resolvedIds.has(id)) {
          missingIds.push(id);
        }
      }
    } catch (error) {
      if (!bestEffort) {
        throw error;
      }

      degraded = true;
    }
  }

  return {
    lookup,
    degraded,
    missingIds,
  };
}

export async function fetchMetaobjectLookupByIds(session, ids = []) {
  const result = await fetchMetaobjectLookupByIdsDetailed(session, ids);
  return result.lookup;
}

export async function fetchMetaobjectLookup(session, ids = []) {
  return fetchMetaobjectLookupByIds(session, ids);
}
