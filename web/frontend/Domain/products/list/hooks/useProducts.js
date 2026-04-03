// src/hooks/useProducts.js
import { useState, useCallback } from "react";
import { useDispatch } from "react-redux";
import { useAuthenticatedFetch } from "../../../../hooks/useAuthenticatedFetch";
import {
    setProducts,
    setCount,
    setPagination,
    setPage,
} from "../../../../store/slices/productSlice";

export default function useProducts() {
    const dispatch = useDispatch();
    const fetchWithAuth = useAuthenticatedFetch();

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [hasFetched, setHasFetched] = useState(false);
    const [isStaleData, setIsStaleData] = useState(false);

    const limit = 20;

    const buildFetchErrorMessage = (err) => {
        if (err?.message === "Failed to fetch") {
            return "Unable to refresh products right now. Showing the last loaded results.";
        }

        if (err?.message === "Products request was interrupted") {
            return err.message;
        }

        return err?.message || "Unable to load products right now.";
    };

    const fetchProducts = useCallback(
        async (pageNumber = 1, filterParams = []) => {
            try {
                setLoading(true);
                setError(null);
                setIsStaleData(false);

                const res = await fetchWithAuth(
                    `/api/products/get-all?page=${pageNumber}&limit=${limit}`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({ filterParams }),
                    }
                );
                if (!res) {
                    throw new Error("Products request was interrupted");
                }

                if (!res.ok) throw new Error("Failed to fetch products");

                const json = await res.json();

                const products = json?.data?.products || [];
                const pagination = json?.data?.pagination || null;
                const count =
                    json?.data?.pagination?.total ?? products.length;

                dispatch(setProducts(products));
                dispatch(setCount(count));
                dispatch(setPagination(pagination));
                dispatch(setPage(pageNumber));
            } catch (err) {
                setError(buildFetchErrorMessage(err));
                setIsStaleData(true);
            } finally {
                setHasFetched(true);
                setLoading(false);
            }
        },
        [dispatch, fetchWithAuth]
    );

    return {
        loading,
        error,
        hasFetched,
        isStaleData,
        fetchProducts,
    };
}
