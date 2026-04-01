// src/hooks/useProducts.js
import { useState, useCallback, useRef } from "react";
import { useDispatch } from "react-redux";
import {
    setProducts,
    setCount,
    setPagination,
    setPage,
} from "../../../../store/slices/productSlice";
import { useAuthenticatedFetch } from "../../../../hooks/useAuthenticatedFetch";

export default function useProducts() {
    const dispatch = useDispatch();
    const fetchWithAuth = useAuthenticatedFetch();
    const requestSequenceRef = useRef(0);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [hasFetched, setHasFetched] = useState(false);

    const limit = 20;

    const fetchProducts = useCallback(
        async (pageNumber = 1, filterParams = []) => {
            const requestId = ++requestSequenceRef.current;

            try {
                setLoading(true);
                setError(null);

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

                if (!res.ok) throw new Error("Failed to fetch products");

                const json = await res.json();

                if (requestId !== requestSequenceRef.current) {
                    return;
                }

                const products = json?.data?.products || [];
                const pagination = json?.data?.pagination || null;
                const count =
                    json?.data?.pagination?.total ?? products.length;

                dispatch(setProducts(products));
                dispatch(setCount(count));
                dispatch(setPagination(pagination));
                dispatch(setPage(pageNumber));
            } catch (err) {
                if (requestId === requestSequenceRef.current) {
                    setError(err.message);
                }
            } finally {
                if (requestId === requestSequenceRef.current) {
                    setHasFetched(true);
                    setLoading(false);
                }
            }
        },
        [dispatch, fetchWithAuth]
    );

    return {
        loading,
        error,
        hasFetched,
        fetchProducts,
    };
}
