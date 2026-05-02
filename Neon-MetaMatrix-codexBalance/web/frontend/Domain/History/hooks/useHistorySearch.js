// web/frontend/domains/history/hooks/useHistorySearch.js
import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { 
  setSearchQuery, 
  selectHistoryFilters 
} from '../../../store/slices/historySlice';
import { debounce } from 'lodash';

/**
 * Custom hook for managing history search
 * @returns {Object} Search state and handlers
 */
export const useHistorySearch = () => {
  const dispatch = useDispatch();
  
  // Redux selectors
  const { search } = useSelector(selectHistoryFilters);
  
  // Handle search input
  const handleSearchChange = useCallback((value) => {
    dispatch(setSearchQuery(value));
  }, [dispatch]);
  
  // Debounced search handler
  const debouncedSearchChange = useCallback(
    debounce((value) => {
      dispatch(setSearchQuery(value));
    }, 300),
    [dispatch]
  );
  
  return {
    searchValue: search,
    handleSearchChange,
    debouncedSearchChange
  };
};