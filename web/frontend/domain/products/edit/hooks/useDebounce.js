import { useState, useEffect, useRef } from "react";

export default function useDebounce(value, delay = 500) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  const latestValueRef = useRef(value);

  useEffect(() => {
    latestValueRef.current = value;

    const timer = window.setTimeout(() => {
      setDebouncedValue(latestValueRef.current);
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}
