import type { FeatureCollection, Point, Polygon, MultiPolygon } from 'geojson';

export interface Preset {
  id: string;
  name: string;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
}

export type FireSource = 'viirs' | 'modis_converted';

export interface CalendarRow {
  month: string; // YYYY-MM
  count: number;
  source: FireSource;
  uncertainty_lo: number;
  uncertainty_hi: number;
}

export interface Anomaly {
  current: number;
  median: number;
  p10: number;
  p90: number;
  z_score: number | null;
  percentile: number;
  /** null when the season hasn't started yet / no onset for this area (contract: Optional) */
  onset_shift_days: number | null;
  /** Season not started yet: already at least this many days later than normal (DECISIONS 15:35) */
  onset_shift_min_days?: number | null;
  /** Backend field: selected month is partial and compared day-matched (null when no_data) */
  month_to_date?: boolean | null;
  /** Backend field: number of days of the month in the data when month_to_date (e.g. 13 = 1st–13th) */
  mtd_days?: number | null;
  /** Legacy/mock name for month_to_date; read only as a fallback */
  is_month_to_date?: boolean;
  /**
   * Area contains zero harmonized grid cells (outside the 5 covered regions).
   * When true the backend sends every numeric field as null: check this first.
   */
  no_data?: boolean;
}

export interface LiveHotspotProperties {
  latitude: number;
  longitude: number;
  brightness?: number;
  scan?: number;
  track?: number;
  acq_date?: string;
  acq_time?: string;
  satellite: 'NOAA-20' | 'NOAA-21';
  instrument: string;
  confidence: 'n' | 'h' | 'l' | string;
  version?: string;
  bright_t31?: number;
  frp?: number;
  daynight?: string;
}

export type LiveHotspotFeature = GeoJSON.Feature<Point, LiveHotspotProperties>;
export type LiveHotspotsCollection = FeatureCollection<Point, LiveHotspotProperties>;

export interface BeforeAfterRow {
  month: string;
  raw: number;
  harmonized: number;
  uncertainty_lo?: number;
  uncertainty_hi?: number;
  source?: 'viirs' | 'modis_converted' | 'mixed';
  partial?: boolean;
}

export interface ValidationData {
  holdout_year: number;
  mae: number;
  mape: number;
  before_after: BeforeAfterRow[];
}

export interface ApiError {
  message: string;
  status?: number;
  /** Set when the request hit the client-side timeout (not a caller abort) */
  timedOut?: boolean;
}

export interface ApiResponse<T> {
  data: T;
  isMock: boolean;
  /** /calendar only: backend X-No-Data header (area outside data coverage) */
  noData?: boolean;
}

export type AreaType = 'preset' | 'bbox' | 'polygon';

export interface AreaSelection {
  type: AreaType;
  presetId?: string;
  name?: string;
  bbox?: [number, number, number, number];
  polygon?: Polygon | MultiPolygon;
}

export interface SelectionState {
  area: AreaSelection;
  startMonth: string;
  endMonth: string;
  selectedMonth: string;
}
