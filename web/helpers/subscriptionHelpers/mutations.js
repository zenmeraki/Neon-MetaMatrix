export const CREATE_SUBSCRIPTION = `
        mutation appSubscriptionCreate(
          $name: String!,
          $interval: AppPricingInterval!,
          $returnUrl: URL!,
          $trialDays: Int,
          $price: Decimal!
        ) {
          appSubscriptionCreate(
            name: $name,
            returnUrl: $returnUrl,
            trialDays: $trialDays,
            lineItems: [
              {
                plan: {
                  appRecurringPricingDetails: {
                    price: { amount: $price, currencyCode: USD },
                    interval: $interval
                  }
                }
              }
            ]
          ) {
            appSubscription {
              id
              name
              status
              trialDays
              createdAt
              currentPeriodEnd
              lineItems {
                plan {
                  pricingDetails {
                    ... on AppRecurringPricing {
                      interval
                      price {
                        amount
                      }
                    }
                  }
                }
              }
            }
            confirmationUrl
            userErrors {
              field
              message
            }
          }
        }
      `;

export const CANCEL_SUBSCRIPTION = `
            mutation appSubscriptionCancel($id: ID!) {
              appSubscriptionCancel(id: $id) {
                appSubscription { id }
                userErrors { field message }
              }
            }
          `;

