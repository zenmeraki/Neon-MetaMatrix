// web/frontend/domains/feedback/hooks/useSuggestionForm.js
import { useState, useCallback } from 'react';
import * as Yup from 'yup';
import { feedbackService } from '../services/feedbackService';

/**
 * Custom hook for managing suggestion form
 * @returns {Object} Form state and handlers
 */
export const useSuggestionForm = () => {
  // Form state
  const [email, setEmail] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  
  // Form schema
  const suggestionSchema = Yup.object().shape({
    email: Yup.string()
      .email('Invalid email format')
      .required('Email is required'),
    suggestion: Yup.string()
      .min(10, 'Suggestion must be at least 10 characters long')
      .required('Suggestion is required')
  });
  
  // Handle form submission
  const handleSubmit = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);
    
    try {
      // Validate form data
      await suggestionSchema.validate({ email, suggestion }, { abortEarly: false });
      
      // Submit suggestion
      await feedbackService.submitSuggestion({ email, suggestion });
      
      // Handle success
      setSuccess(true);
      setEmail('');
      setSuggestion('');
    } catch (err) {
      // Handle validation errors
      if (err instanceof Yup.ValidationError) {
        setError(err.errors[0]);
      } else {
        // Handle API errors
        setError(err.message || 'An unexpected error occurred');
      }
    } finally {
      setLoading(false);
    }
  }, [email, suggestion]);
  
  // Reset form
  const resetForm = useCallback(() => {
    setEmail('');
    setSuggestion('');
    setError(null);
    setSuccess(false);
  }, []);
  
  return {
    // Form state
    email,
    setEmail,
    suggestion,
    setSuggestion,
    loading,
    error,
    success,
    
    // Form handlers
    handleSubmit,
    resetForm
  };
};