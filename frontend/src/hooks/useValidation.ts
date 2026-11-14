import { useState, useEffect } from 'react';
import type { ValidationData, ApiError } from '../api/types';
import { fetchValidation } from '../api/api';

export function useValidation() {
  const [data, setData] = useState<ValidationData | null>(null);
  const [isMock, setIsMock] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchValidation(controller.signal)
      .then((res) => {
        setData(res.data);
        setIsMock(res.isMock);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === 'AbortError') return;
        setData(null);
        setIsMock(false);
        setError(err as ApiError);
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, []);

  return { data, isMock, loading, error };
}
