/**
 * Format numbers with comma separators, e.g. 18,520
 */
export function formatCount(value: number | undefined | null, decimals = 0): string {
  if (value === undefined || value === null || isNaN(value)) {
    return '—';
  }
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format percentage, e.g. "42.5%"
 */
export function formatPercent(value: number | undefined | null, decimals = 1): string {
  if (value === undefined || value === null || isNaN(value)) {
    return '—';
  }
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format z-score with sign, e.g. "+1.42" or "-0.68"
 */
export function formatZScore(value: number | undefined | null): string {
  if (value === undefined || value === null || isNaN(value)) {
    return '—';
  }
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}`;
}

/**
 * Format YYYY-MM into human readable format, e.g. "November 2026"
 */
export function formatMonthName(monthStr: string): string {
  if (!monthStr || !monthStr.includes('-')) return monthStr;
  const [yearStr, monthNumStr] = monthStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthNumStr, 10) - 1;
  const date = new Date(Date.UTC(year, month, 1));
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Format YYYY-MM into short month, e.g. "Nov '26"
 */
export function formatMonthShort(monthStr: string): string {
  if (!monthStr || !monthStr.includes('-')) return monthStr;
  const [yearStr, monthNumStr] = monthStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthNumStr, 10) - 1;
  const date = new Date(Date.UTC(year, month, 1));
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

/**
 * Format bounding box coordinates nicely for display
 */
export function formatBBox(bbox?: [number, number, number, number]): string {
  if (!bbox || bbox.length < 4) return 'Global';
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return `${minLat.toFixed(2)}°N, ${minLon.toFixed(2)}°E to ${maxLat.toFixed(2)}°N, ${maxLon.toFixed(2)}°E`;
}
