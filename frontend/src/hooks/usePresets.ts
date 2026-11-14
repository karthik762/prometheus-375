import { useState, useEffect } from 'react';
import type { Preset, ApiError } from '../api/types';
import { fetchPresets } from '../api/api';

export function usePresets() {
  const [data, setData] = useState<Preset[] | null>(null);
  const [isMock, setIsMock] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchPresets(controller.signal)
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
