import type {
  Preset,
  CalendarRow,
  Anomaly,
  LiveHotspotsCollection,
  ValidationData,
  AreaSelection,
  ApiError,
  ApiResponse,
} from './types';

// Mock data imports for offline dev mode (when VITE_API_URL is empty)
import mockPresets from './mock/presets.json';
import mockCalendar from '../mocks/calendar_punjab.json';
import mockAnomaly from './mock/anomaly.json';
import mockLive from './mock/live.geojson';
import mockValidation from './mock/validation.json';
// Exact copy of the live /presets response — fallback when the backend is down
import bundledPresets from '../mocks/presets.json';

const API_BASE = (typeof import.meta.env?.VITE_API_URL === 'string'
  ? import.meta.env.VITE_API_URL.trim()
  : ''
).replace(/\/+$/, '');

export function isOfflineMockMode(): boolean {
  return !API_BASE;
}

/**
 * Shared fetch helper
 * - Uses mock data ONLY when VITE_API_URL is empty
 * - When VITE_API_URL is set, NEVER falls back to mock; throws ApiError with HTTP status
 */
async function request<T>(
  endpoint: string,
  searchParams: Record<string, string | number | undefined>,
  signal: AbortSignal | undefined,
  mockData: T
): Promise<ApiResponse<T>> {
  // If no API URL configured -> offline / dev mode with mock data
  if (!API_BASE) {
    return { data: mockData, isMock: true };
  }

  // When API URL is configured -> strictly call the backend. Never fall back to mock!
  const url = new URL(`${API_BASE}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`);
  Object.entries(searchParams).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  });

  try {
    const res = await fetch(url.toString(), {
      signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      if (res.status === 404) {
        throw {
          status: 404,
          message: 'Not available yet',
        } as ApiError;
      }
      // Keep raw server text out of the UI; sections show this message to visitors
      throw {
        status: res.status,
        message:
          res.status >= 500
            ? `The data server had a problem (HTTP ${res.status}). Try again in a moment.`
            : `The data server rejected this request (HTTP ${res.status}).`,
      } as ApiError;
    }

    const json = (await res.json()) as T;
    return { data: json, isMock: false };
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') {
      throw err; // caller handles aborted signal
    }
    if ((err as ApiError)?.status !== undefined) {
      throw err;
    }
    // Network failure (backend down, unreachable, or still waking up after idle)
    throw {
      status: 0,
      message: "Can't reach the data server. If the site was idle it may be waking up (about 30 s), so try again shortly.",
    } as ApiError;
  }
}

/**
 * Builds spatial query parameters from AreaSelection
 */
export function buildSpatialParams(area: AreaSelection): Record<string, string> {
  const params: Record<string, string> = {};
  if (area.polygon) {
    params.polygon = JSON.stringify(area.polygon);
  } else if (area.bbox) {
    params.bbox = area.bbox.join(',');
  }
  return params;
}

/**
 * GET /presets
 */
export async function fetchPresets(signal?: AbortSignal): Promise<ApiResponse<Preset[]>> {
  try {
    return await request<Preset[]>('/presets', {}, signal, mockPresets as Preset[]);
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') throw err;
    // Backend down (e.g. Render 502/cold start): presets are static config, so use the
    // bundled copy of the real /presets response rather than showing no area buttons.
    // Not flagged as mock — it is the same data the backend serves.
    console.warn('[presets] /presets failed, using bundled copy:', err);
    return { data: bundledPresets as Preset[], isMock: false };
  }
}

/**
 * GET /calendar?start=YYYY-MM&end=YYYY-MM&polygon/bbox=...
 */
export async function fetchCalendar(
  area: AreaSelection,
  startMonth?: string,
  endMonth?: string,
  signal?: AbortSignal
): Promise<ApiResponse<CalendarRow[]>> {
  const params: Record<string, string | undefined> = {
    ...buildSpatialParams(area),
    start: startMonth,
    end: endMonth,
  };

  let filteredMock = mockCalendar as CalendarRow[];
  if (startMonth) {
    filteredMock = filteredMock.filter((row) => row.month >= startMonth);
  }
  if (endMonth) {
    filteredMock = filteredMock.filter((row) => row.month <= endMonth);
  }

  return request<CalendarRow[]>('/calendar', params, signal, filteredMock);
}

/**
 * GET /anomaly?month=YYYY-MM&polygon/bbox=...
 */
export async function fetchAnomaly(
  area: AreaSelection,
  month: string,
  signal?: AbortSignal
): Promise<ApiResponse<Anomaly>> {
  const params: Record<string, string | undefined> = {
    ...buildSpatialParams(area),
    month,
  };

  return request<Anomaly>('/anomaly', params, signal, buildMockAnomaly(month));
}

/**
 * Offline mode: derive the anomaly for `month` from the real Punjab calendar
 * series (same calendar month in the other years = the "normal"), so the card
 * changes as the slider moves. The current month is month-to-date and needs a
 * day-matched baseline (DECISIONS 13:10), which the monthly series can't give —
 * so it keeps the hand-written mock in mock/anomaly.json.
 */
function buildMockAnomaly(month: string): Anomaly {
  const fallback = mockAnomaly as Anomaly;
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (!month || month >= currentMonth) return fallback;

  const rows = mockCalendar as CalendarRow[];
  const current = rows.find((r) => r.month === month)?.count;
  const mm = month.slice(5);
  const baseline = rows
    .filter((r) => r.month.slice(5) === mm && r.month !== month && r.month < currentMonth)
    .map((r) => r.count)
    .sort((a, b) => a - b);
  if (current === undefined || baseline.length < 3) return fallback;

  const q = (p: number) => {
    const i = (baseline.length - 1) * p;
    const lo = Math.floor(i);
    return baseline[lo] + (baseline[Math.ceil(i)] - baseline[lo]) * (i - lo);
  };
  const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const sd = Math.sqrt(baseline.reduce((a, b) => a + (b - mean) ** 2, 0) / (baseline.length - 1));
  return {
    current,
    median: q(0.5),
    p10: q(0.1),
    p90: q(0.9),
    z_score: sd > 0 ? (current - mean) / sd : 0,
    percentile: (100 * baseline.filter((v) => v <= current).length) / baseline.length,
    onset_shift_days: null,
    is_month_to_date: false,
  };
}

const LIVE_TIMEOUT_MS = 15_000;
const EMPTY_LIVE: LiveHotspotsCollection = { type: 'FeatureCollection', features: [] };

export interface LiveResponse extends ApiResponse<LiveHotspotsCollection> {
  /** Set when /live failed or timed out; data is then an empty FeatureCollection. */
  error: ApiError | null;
}

/**
 * GET /live?days=7&polygon/bbox=...
 *
 * Unlike the other endpoints this never throws on a backend failure and never
 * substitutes the Punjab mock: a slow/failed live feed must not look like real
 * detections for whatever area is selected. It resolves to an empty collection
 * plus `error`. The mock is used only in offline mode (no VITE_API_URL).
 * Rejects only with AbortError when the caller's `signal` aborts.
 */
export async function fetchLiveHotspots(
  area: AreaSelection,
  days = 7,
  signal?: AbortSignal
): Promise<LiveResponse> {
  if (!API_BASE) {
    return { data: mockLive as unknown as LiveHotspotsCollection, isMock: true, error: null };
  }

  // Own controller so we can time out without confusing it with a caller abort
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener('abort', onCallerAbort);
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);

  try {
    const res = await request<LiveHotspotsCollection>(
      '/live',
      { ...buildSpatialParams(area), days },
      controller.signal,
      EMPTY_LIVE
    );
    return { data: res.data, isMock: false, error: null };
  } catch (err: unknown) {
    if (signal?.aborted) throw err; // superseded by a newer request
    const error: ApiError =
      (err as Error)?.name === 'AbortError'
        ? { status: 0, message: `Live feed timed out after ${LIVE_TIMEOUT_MS / 1000}s` }
        : (err as ApiError);
    return { data: EMPTY_LIVE, isMock: false, error };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

/**
 * GET /validation
 */
export async function fetchValidation(signal?: AbortSignal): Promise<ApiResponse<ValidationData>> {
  return request<ValidationData>('/validation', {}, signal, mockValidation as ValidationData);
}

export interface ExportLink {
  url: string;
  isMock: boolean;
  label: string;
}

/**
 * Export URLs (Plain links for direct browser download)
 */
export function getExportHotspotsCsvUrl(
  area: AreaSelection,
  startMonth?: string,
  endMonth?: string
): ExportLink {
  if (!API_BASE) {
    const header = 'cell_id,lat,lon,month,harmonized_count,source,uncertainty\n';
    const rows = (mockCalendar as CalendarRow[])
      .filter((r) => (!startMonth || r.month >= startMonth) && (!endMonth || r.month <= endMonth))
      .map(
        (r) =>
          `30.500_75.500,30.5,75.5,${r.month},${r.count},${r.source},${((r.uncertainty_hi - r.uncertainty_lo) / 2).toFixed(1)}`
      )
      .join('\n');
    return {
      url: `data:text/csv;charset=utf-8,${encodeURIComponent(header + rows)}`,
      isMock: true,
      label: 'Sample CSV',
    };
  }

  const url = new URL(`${API_BASE}/export.csv`);
  if (startMonth) url.searchParams.set('start', startMonth);
  if (endMonth) url.searchParams.set('end', endMonth);
  const spatial = buildSpatialParams(area);
  Object.entries(spatial).forEach(([k, v]) => url.searchParams.set(k, v));
  return {
    url: url.toString(),
    isMock: false,
    label: 'Download CSV',
  };
}

export function getExportAnalyticsCsvUrl(
  area: AreaSelection,
  startMonth?: string,
  endMonth?: string
): ExportLink {
  if (!API_BASE) {
    const header = 'month,count,source,uncertainty_lo,uncertainty_hi\n';
    const rows = (mockCalendar as CalendarRow[])
      .filter((r) => (!startMonth || r.month >= startMonth) && (!endMonth || r.month <= endMonth))
      .map((r) => `${r.month},${r.count},${r.source},${r.uncertainty_lo},${r.uncertainty_hi}`)
      .join('\n');
    return {
      url: `data:text/csv;charset=utf-8,${encodeURIComponent(header + rows)}`,
      isMock: true,
      label: 'Sample CSV',
    };
  }

  const url = new URL(`${API_BASE}/export_analytics.csv`);
  if (startMonth) url.searchParams.set('start', startMonth);
  if (endMonth) url.searchParams.set('end', endMonth);
  const spatial = buildSpatialParams(area);
  Object.entries(spatial).forEach(([k, v]) => url.searchParams.set(k, v));
  return {
    url: url.toString(),
    isMock: false,
    label: 'Download CSV',
  };
}
