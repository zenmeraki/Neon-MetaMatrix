import { getAuthenticatedFetch } from "../../../hooks/useAuthenticatedFetch";

export const feedbackService = {

    async submitSuggestion(data) {
      try {
        const response = await getAuthenticatedFetch()('/api/suggestion/submit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        });
  
        if (!response.ok) {
          throw new Error(`Failed to submit suggestion: ${response.statusText}`);
        }
  
        const result = await response.json();
        return result;
  
      } catch (error) {
        console.error('Error submitting suggestion:', error);
        throw error;
      }
    }
  
  };
  
