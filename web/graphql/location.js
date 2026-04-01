export const GetLocations = `
  query GetLocations($search: String) {
    locations(first: 20, query: $search) {
      edges {
        node {
          id
          name
        }
      }
    }
  }
`;