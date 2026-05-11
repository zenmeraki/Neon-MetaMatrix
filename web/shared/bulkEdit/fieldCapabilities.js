export const FIELD_CAPABILITIES = {
  price: {
    type: "MONEY",
    allowedEditTypes: [
      "SET",
      "INCREASE",
      "DECREASE",
      "PERCENT_INCREASE",
      "PERCENT_DECREASE",
    ],
    requiresVariantTarget: true,
    destructive: true,
    supportsRounding: true,
  },

  title: {
    type: "TEXT",
    allowedEditTypes: ["SET", "APPEND", "PREPEND", "SEARCH_REPLACE"],
    destructive: false,
  },

  status: {
    type: "ENUM",
    allowedEditTypes: ["SET"],
    allowedValues: ["ACTIVE", "DRAFT", "ARCHIVED"],
    destructive: true,
  },

  inventoryQuantity: {
    type: "INTEGER",
    allowedEditTypes: ["SET", "INCREASE", "DECREASE"],
    requiresLocation: true,
    destructive: true,
  },

  tags: {
    type: "TAGS",
    allowedEditTypes: ["ADD", "REMOVE", "SET"],
    destructive: false,
  },
};

