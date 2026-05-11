export const GET_ACTIVE_SUBSCRIPTION = `
        query {
          appInstallation {
            activeSubscriptions {
              id
              name
              status
            }
          }
        }
      `;

export const GET_CURRENT_ACTIVE_SUBSCRIPTION = `
      query {
        currentAppInstallation {
          activeSubscriptions {
            id
            name
            status
            lineItems {
              plan {
                pricingDetails {
                  ... on AppRecurringPricing {
                    interval
                    price {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;
      