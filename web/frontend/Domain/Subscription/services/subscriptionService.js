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
  };
  