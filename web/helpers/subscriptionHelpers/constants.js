import { BillingInterval } from "@shopify/shopify-api";

export const validPlans = {
  freeversion: { name: "Free Version", price: 0 },
  basic_monthly: {
    name: "Basic (Monthly)",
    price: 20,
    interval: BillingInterval.Every30Days,
  },
  advanced_monthly: {
    name: "Advanced (Monthly)",
    price: 50,
    interval: BillingInterval.Every30Days,
  },
  // advanced_yearly: {
  //   name: "Advanced (Yearly)",
  //   price: 100,
  //   interval: BillingInterval.Annual,
  // },
  pro_monthly: {
    name: "Pro (Monthly)",
    price: 100,
    interval: BillingInterval.Every30Days,
  },
};
