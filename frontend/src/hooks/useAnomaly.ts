import type { Anomaly } from '../api/types';
import { anomalyParams, fetchAnomaly, peekCached } from '../api/api';
import { useSelection } from './useSelection';
import { useApiQuery, useAreaKey } from './useApiQuery';

export function useAnomaly() {
  const { area, selectedMonth } = useSelection();
  const areaKey = useAreaKey(area);

  return useApiQuery<Anomaly>({
    key: `anomaly|${areaKey}|${selectedMonth}`,
    groupKey: areaKey,
    fetcher: (signal) => fetchAnomaly(area, selectedMonth, signal),
    peek: () => peekCached<Anomaly>('/anomaly', anomalyParams(area, selectedMonth)),
  });
}
