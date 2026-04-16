import { create } from "zustand";

const initialState = {
  products: [],
  filters: [],
  search: "",
  count: 0,
  pagination: null,
  page: 1,
};

function areFiltersEqual(currentFilters, nextFilters) {
  if (currentFilters === nextFilters) return true;
  if (currentFilters.length !== nextFilters.length) return false;

  return currentFilters.every((currentFilter, index) => {
    const nextFilter = nextFilters[index];
    return (
      currentFilter.field === nextFilter.field &&
      currentFilter.operator === nextFilter.operator &&
      currentFilter.value === nextFilter.value
    );
  });
}

export const useProductStore = create((set) => ({
  ...initialState,
  setProductsResult: ({ products = [], pagination = null, count = 0, page = 1 }) =>
    set({
      products,
      pagination,
      count,
      page,
    }),
  setFilters: (filters) =>
    set((state) => {
      if (areFiltersEqual(state.filters, filters)) return state;
      return { filters, page: 1 };
    }),
  setSearch: (search) =>
    set((state) => {
      if (state.search === search) return state;
      return { search, page: 1 };
    }),
  clearFilters: () =>
    set((state) => {
      if (!state.filters.length && !state.search && state.page === 1) {
        return state;
      }

      return {
        filters: [],
        search: "",
        page: 1,
      };
    }),
}));

export const selectProducts = (state) => state.products;
export const selectFilters = (state) => state.filters;
export const selectSearch = (state) => state.search;
export const selectProductCount = (state) => state.count;
export const selectPagination = (state) => state.pagination;
export const selectPage = (state) => state.page;
export const selectSetFilters = (state) => state.setFilters;
export const selectSetSearch = (state) => state.setSearch;
export const selectClearFilters = (state) => state.clearFilters;
