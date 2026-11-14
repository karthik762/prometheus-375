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
      const errText = await res.text().catch(() => '');
      throw {
        status: res.status,
        message: errText || `API request failed with status ${res.status}`,
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
    // Network failure (backend down or unreachable)
    throw {
      status: 0,
      message: (err as Error)?.message || 'Network request failed',
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
  return request<Preset[]>('/presets', {}, signal, mockPresets as Preset[]);
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

  return request<Anomaly>('/anomaly', params, signal, mockAnomaly as Anomaly);
}

/**
 * GET /live?days=7&polygon/bbox=...
 */
export async function fetchLiveHotspots(
  area: AreaSelection,
  days = 7,
  signal?: AbortSignal
): Promise<ApiResponse<LiveHotspotsCollection>> {
  const params: Record<string, string | number | undefined> = {
    ...buildSpatialParams(area),
    days,
  };

  return request<LiveHotspotsCollection>(
    '/live',
    params,
    signal,
    mockLive as unknown as LiveHotspotsCollection
  );
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
