import { useState, useEffect, useCallback, useRef } from 'react';
import type { LiveHotspotsCollection, ApiError } from '../api/types';
import { fetchLiveHotspots } from '../api/api';
import { useSelection } from './useSelection';

export interface LiveState {
  data: LiveHotspotsCollection | null;
  isMock: boolean;
  loading: boolean;
  /** Non-null when the live feed failed/timed out (data is then empty, never mock). */
  error: ApiError | null;
  refetch: () => void;
}

export function useLive(days = 7): LiveState {
  const { area } = useSelection();
  const [data, setData] = useState<LiveHotspotsCollection | null>(null);
  const [isMock, setIsMock] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<ApiError | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const loadData = useCallback(() => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    fetchLiveHotspots(area, days, controller.signal)
      .then((res) => {
        setData(res.data);
        setIsMock(res.isMock);
        setError(res.error);
        setLoading(false);
      })
      .catch((err: unknown) => {
        // fetchLiveHotspots only rejects on abort (a newer request superseded this one)
        if ((err as Error)?.name === 'AbortError' || controller.signal.aborted) return;
        setData({ type: 'FeatureCollection', features: [] });
        setIsMock(false);
        setError({ status: 0, message: (err as Error)?.message || 'Live feed failed' });
        setLoading(false);
      });
  }, [area, days]);

  useEffect(() => {
    loadData();
    return () => abortControllerRef.current?.abort();
  }, [loadData]);

  return { data, isMock, loading, error, refetch: loadData };
}
