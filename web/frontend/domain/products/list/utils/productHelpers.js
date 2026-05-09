export const getStatusColor = (status) => {

  switch (status) {

    case "ACTIVE":
      return "success";

    case "DRAFT":
      return "attention";

    case "ARCHIVED":
      return "critical";

    default:
      return "subdued";

  }

};

export const isEmpty = (value) =>
    Array.isArray(value) ? value.length === 0 : !value;

export const disambiguateLabel = (key, value) => {
    switch (key) {
        case "availability":
            return value.map((v) => `Available on ${v}`).join(", ");
        case "productType":
            return value.join(", ");
        default:
            return value.toString();
    }
};
