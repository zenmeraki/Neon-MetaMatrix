import shopify from "../../shopify.js";

export async function fetchMetaobjectLookup(session) {
  const client = new shopify.api.clients.Graphql({ session });

  const types = [
    "age_group",
    "color",
    "fabric",
    "fit",
    "size",
    "target_gender",
    "waist_rise",
  ];

  const lookup = new Map();

  for (const type of types) {
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
      const query = `
        query GetMetaobjects($type: String!, $cursor: String) {
          metaobjects(type: $type, first: 250, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id
                fields { key value }
              }
            }
          }
        }
      `;

      const response = await client.query({
        data: {
          query,
          variables: { type, cursor },
        },
      });

      const metaobjects = response.body?.data?.metaobjects;
      const edges = metaobjects?.edges || [];

      for (const { node } of edges) {
        const label = node.fields.find(
          (f) => f.key === "name" || f.key === "label" || f.key === "value"
        )?.value;

        if (node.id && label) {
          lookup.set(node.id, label);
        }
      }

      hasNextPage = metaobjects?.pageInfo?.hasNextPage ?? false;
      cursor = metaobjects?.pageInfo?.endCursor ?? null;
    }
  }

  return lookup;
}