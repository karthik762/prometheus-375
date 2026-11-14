import { useState, useEffect, useCallback, useRef } from 'react';
import type { LiveHotspotsCollection, ApiError } from '../api/types';
import { fetchLiveHotspots } from '../api/api';
import { useSelection } from './useSelection';

export function useLive(days = 7) {
  const { area } = useSelection();
  const [data, setData] = useState<LiveHotspotsCollection | null>(null);
  const [isMock, setIsMock] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<ApiError | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const loadData = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    fetchLiveHotspots(area, days, controller.signal)
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
  }, [area, days]);

  useEffect(() => {
    loadData();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [loadData]);

  return { data, isMock, loading, error, refetch: loadData };
}
