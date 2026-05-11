// web/frontend/store/slices/productSlice.js
import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  products: [],
  filters: [],
  search: "", // ✅ NEW
  count: 0,
  pagination: null,
  page: 1,
  frozenTarget: null,
};

const productSlice = createSlice({
  name: "products",
  initialState,
  reducers: {
    setProducts(state, action) {
      state.products = action.payload;
    },

    appendProducts(state, action) {
      const seen = new Set(state.products.map((product) => String(product.id)));
      const nextProducts = Array.isArray(action.payload) ? action.payload : [];

      for (const product of nextProducts) {
        const id = String(product?.id || "");
        if (!id || seen.has(id)) continue;

        seen.add(id);
        state.products.push(product);
      }
    },

    setFilters(state, action) {
      state.filters = action.payload;
      state.page = 1; // reset page on filter change
    },

    clearFilters(state) {
      state.filters = [];
      state.search = ""; // ✅ clear search also
      state.page = 1;
    },

    setSearch(state, action) {
      state.search = action.payload;
      state.page = 1;
    },

    setCount(state, action) {
      state.count = action.payload;
    },

    setPagination(state, action) {
      state.pagination = action.payload;
    },

    setPage(state, action) {
      state.page = action.payload;
    },

    setFrozenTarget(state, action) {
      state.frozenTarget = action.payload;
    },

    clearFrozenTarget(state) {
      state.frozenTarget = null;
    },
  },
});

export const {
  setProducts,
  appendProducts,
  setFilters,
  clearFilters,
  setSearch, // ✅ EXPORT
  setCount,
  setPagination,
  setPage,
  setFrozenTarget,
  clearFrozenTarget,
} = productSlice.actions;

export default productSlice.reducer;

/* ===============================
   Selectors
================================ */
export const selectProducts = (state) => state.products.products;
export const selectFilters = (state) => state.products.filters;
export const selectSearch = (state) => state.products.search; // ✅ NEW
export const selectProductCount = (state) => state.products.count;
export const selectPagination = (state) => state.products.pagination;
export const selectPage = (state) => state.products.page;
export const selectFrozenTarget = (state) => state.products.frozenTarget;
