import type { CalendarRow } from '../api/types';
import { calendarParams, fetchCalendar, peekCached } from '../api/api';
import { useSelection } from './useSelection';
import { useApiQuery, useAreaKey } from './useApiQuery';

export function useCalendar() {
  const { area, startMonth, endMonth } = useSelection();
  const areaKey = useAreaKey(area);

  return useApiQuery<CalendarRow[]>({
    key: `calendar|${areaKey}|${startMonth}|${endMonth}`,
    groupKey: areaKey,
    fetcher: (signal) => fetchCalendar(area, startMonth, endMonth, signal),
    peek: () => peekCached<CalendarRow[]>('/calendar', calendarParams(area, startMonth, endMonth)),
  });
}
