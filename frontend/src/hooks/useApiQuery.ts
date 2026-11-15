import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiError, ApiResponse, AreaSelection } from '../api/types';
import { buildSpatialParams } from '../api/api';

/** Time-only changes (slider drag, date inputs) wait this long before fetching. */
export const QUERY_DEBOUNCE_MS = 300;

export interface QueryState<T> {
  data: T | null;
  isMock: boolean;
  /** Backend says the area is outside data coverage (calendar: X-No-Data header) */
  noData: boolean;
  loading: boolean;
  error: ApiError | null;
  refetch: () => void;
}

type Result<T> = ApiResponse<T> & { error?: ApiError | null };

interface Options<T> {
  /** Full identity of the request (area + every query param). */
  key: string;
  /**
   * Area part of the key. A change of `key` within the same group (only the
   * dates moved) is debounced; a new area or the first load fetches at once.
   */
  groupKey: string;
  fetcher: (signal: AbortSignal) => Promise<Result<T>>;
  /** Synchronous cache lookup; a hit renders immediately with no loading state. */
  peek: () => ApiResponse<T> | undefined;
  debounceMs?: number;
}

/** Stable string for an area, used as the cache/debounce group. */
export function useAreaKey(area: AreaSelection): string {
  return useMemo(() => JSON.stringify(buildSpatialParams(area)), [area]);
}

/**
 * Debounced + abortable + cached fetch.
 * - Every key change aborts the previous in-flight request. Aborted requests never
 *   touch state, so they can't show an error or empty card; the UI stays "loading"
 *   until the newest request settles.
 * - Cache hits (see api.ts) resolve synchronously, so going back is instant.
 */
export function useApiQuery<T>({
  key,
  groupKey,
  fetcher,
  peek,
  debounceMs = QUERY_DEBOUNCE_MS,
}: Options<T>): QueryState<T> {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const peekRef = useRef(peek);
  peekRef.current = peek;

  const [state, setState] = useState<Omit<QueryState<T>, 'refetch'>>(() => {
    const hit = peek();
    return hit
      ? { data: hit.data, isMock: hit.isMock, noData: !!hit.noData, loading: false, error: null }
      : { data: null, isMock: false, noData: false, loading: true, error: null };
  });

  const prevGroupRef = useRef<string | null>(null);
  const retryRef = useRef(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const sameGroup = prevGroupRef.current === groupKey;
    prevGroupRef.current = groupKey;
    const isRetry = retryRef.current;
    retryRef.current = false;

    const hit = peekRef.current();
    if (hit) {
      setState({ data: hit.data, isMock: hit.isMock, noData: !!hit.noData, loading: false, error: null });
      return;
    }

    // Keep the previous data so the map doesn't flash empty; consumers gate on `loading`
    setState((s) => ({ ...s, loading: true, error: null }));

    const controller = new AbortController();
    const delay = sameGroup && !isRetry ? debounceMs : 0;
    const timer = setTimeout(() => {
      fetcherRef.current(controller.signal)
        .then((res) => {
          if (controller.signal.aborted) return;
          setState({ data: res.data, isMock: res.isMock, noData: !!res.noData, loading: false, error: res.error ?? null });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || (err as Error)?.name === 'AbortError') return;
          const apiErr: ApiError =
            (err as ApiError)?.message !== undefined
              ? (err as ApiError)
              : { status: 0, message: 'Request failed' };
          setState({ data: null, isMock: false, noData: false, loading: false, error: apiErr });
        });
    }, delay);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, groupKey, nonce, debounceMs]);

  const refetch = useCallback(() => {
    retryRef.current = true;
    setNonce((n) => n + 1);
  }, []);

  return { ...state, refetch };
}
