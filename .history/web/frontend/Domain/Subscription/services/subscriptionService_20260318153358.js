export const subscriptionService = {
    /**
     * Get available subscription plans
     * @returns {Promise<Array>} List of subscription plans
     */
    async getSubscriptionPlans() {
      try {
        const response = await fetch('/api/subscription/get-plans');
  
        if (!response.ok) {
          throw new Error(`Failed to fetch plans: ${response.statusText}`);
        }
  
        return await response.json();
      } catch (error) {
        console.error('Error fetching subscription plans:', error);
        throw error;
      }
    },
  
    /**
     * Verify current active plan
     * @returns {Promise<Object>} Active plan information
     */
    async verifyPlan() {
      try {
        const response = await fetch('/api/subscription/verify-plan');
  
        if (!response.ok) {
          throw new Error(`Failed to verify plan: ${response.statusText}`);
        }
  
        return await response.json();
      } catch (error) {
        console.error('Error verifying plan:', error);
        throw error;
      }
    },
  
    /**
     * Activate billing with a charge ID
     * @param {string} chargeId - Shopify charge ID
     * @returns {Promise<Object>} Activated plan information
     */
    
    async activateBilling(chargeId) {
      try {
        const response = await fetch(`/api/subscription/activate/billing?charge_id=${encodeURIComponent(chargeId)}`);
  
        if (!response.ok) {
          throw new Error(`Failed to activate billing: ${response.statusText}`);
        }
  
        return await response.json();
      } catch (error) {
        console.error('Error activating billing:', error);
        throw error;
      }
    },
  
    /**
     * Create a new subscription
     * @param {Object} plan - Plan to subscribe to
     * @returns {Promise<Object>} Subscription result with confirmation URL
     */
    async createSubscription(plan) {
      try {
        
        const response = await fetch('/api/subscription/create-subscription', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(plan),
        });
  
        if (!response.ok) {
          throw new Error(`Failed to create subscription: ${response.statusText}`);
        }
  
        return await response.json();
      } catch (error) {
        console.error('Error creating subscription:', error);
        throw error;
      }
    },
  
    /**
     * Cancel current subscription
     * @returns {Promise<Object>} Cancellation result
     */
    // async cancelSubscription() {
    //   try {
    //     const response = await fetch('/api/subscriptions/cancel', {
    //       method: 'POST',
    //     });
  
    //     if (!response.ok) {
    //       throw new Error(`Failed to cancel subscription: ${response.statusText}`);
    //     }
  
    //     return await response.json();
    //   } catch (error) {
    //     console.error('Error cancelling subscription:', error);
    //     throw error;
    //   }
    // }
  };
  