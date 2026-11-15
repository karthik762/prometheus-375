import type { LiveHotspotsCollection } from '../api/types';
import { fetchLiveHotspots, liveParams, peekCached } from '../api/api';
import { useSelection } from './useSelection';
import { useApiQuery, useAreaKey, type QueryState } from './useApiQuery';

/** `error` is non-null when the live feed failed/timed out (data is then empty, never mock). */
export type LiveState = QueryState<LiveHotspotsCollection>;

/**
 * /live has no date parameters (always the last `days` days), so this depends on
 * the area only: moving the time slider or date inputs never refetches it.
 */
export function useLive(days = 7): LiveState {
  const { area } = useSelection();
  const areaKey = useAreaKey(area);

  return useApiQuery<LiveHotspotsCollection>({
    key: `live|${areaKey}|${days}`,
    groupKey: areaKey,
    fetcher: (signal) => fetchLiveHotspots(area, days, signal),
    peek: () => peekCached<LiveHotspotsCollection>('/live', liveParams(area, days)),
  });
}
