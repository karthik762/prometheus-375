import { useState, useEffect, useCallback, useRef } from 'react';
import type { CalendarRow, ApiError } from '../api/types';
import { fetchCalendar } from '../api/api';
import { useSelection } from './useSelection';

export function useCalendar() {
  const { area, startMonth, endMonth } = useSelection();
  const [data, setData] = useState<CalendarRow[] | null>(null);
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

    fetchCalendar(area, startMonth, endMonth, controller.signal)
      .then((res) => {
        setData(res.data);
        setIsMock(res.isMock);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === 'AbortError') {
          return;
        }
        setData(null);
        setIsMock(false);
        setError(err as ApiError);
        setLoading(false);
      });
  }, [area, startMonth, endMonth]);

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
