// src/hooks/useProducts.js
import { useState, useCallback } from "react";
import { useDispatch } from "react-redux";
import {
    setProducts,
    setCount,
    setPagination,
    setPage,
} from "../../../../store/slices/productSlice";

export default function useProducts() {
    const dispatch = useDispatch();

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const limit = 20;

    const fetchProducts = useCallback(
        async (pageNumber = 1, filterParams = []) => {
            try {
                setLoading(true);
                setError(null);

                const res = await fetch(
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

                const products = json?.data?.products || [];
                const pagination = json?.data?.pagination || null;
                const count =
                    json?.data?.pagination?.total ?? products.length;

                dispatch(setProducts(products));
                dispatch(setCount(count));
                dispatch(setPagination(pagination));
                dispatch(setPage(pageNumber));
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        },
        [dispatch]
    );

    return {
        loading,
        error,
        fetchProducts,
    };
}
