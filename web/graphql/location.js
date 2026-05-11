export const GetLocations = `
  query GetLocations($search: String, $first: Int!, $after: String) {
    locations(first: $first, after: $after, query: $search) {
      edges {
        cursor
        node {
          id
          name
          isActive
          fulfillsOnlineOrders
          hasActiveInventory
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;
