# backend/data — final pipeline outputs

Copied from `data/processed/` (which stays git-ignored) so the backend and the Render
deploy can read them directly. **Data through 13 Nov 2026** (November 2026 is month-to-date, 13 days).

Produced by the pipeline at:
- **D5** `c762b1a` — `[data] D5: 05_series + 06_validate`
- **D6** `96a0709` — `[data] D6: 07_anomaly + 08_onset`

Regions: `india`, `brazil`, `australia`, `california`, `greece`.

## Files

| File | What it is |
|---|---|
| `harmonized.parquet` | All regions combined, contract schema: `cell_id, lat, lon, month (YYYY-MM), harmonized_count, source ('viirs'\|'modis_converted'), uncertainty`. 0.25° grid × month, one-VIIRS-satellite scale. |
| `harmonized_<region>.parquet` | Same schema, one region per file (5 files). |
| `before_after.parquet` | Per cell × month: `cell_id, month, raw, harmonized`. Feeds the before/after chart and `/validation`. |
| `metrics.json` | 2020 holdout validation: MAE/MAPE per region and sub-area (e.g. `india.pb_hr`), baseline (single global MODIS→VIIRS ratio) and improvement %, monthly actual vs predicted. |
| `anomaly_<region>.parquet` | Per area × month: `current, median, p10, p90, z_score, percentile, n_prior_years, modis_share, month_to_date, mtd_days`. Feeds `/anomaly`. (5 files) |
| `onset_<region>.parquet` | Per area × season: `season_start/end, complete, season_total, threshold, onset_date, onset_day, median_prior_onset_day, onset_shift_days`, etc. (5 files) |
| `anomaly_preset_<preset_id>.parquet` | Same columns as `anomaly_<region>` (+ `std_val`) for each non-India preset box (`brazil_pantanal`, `australia_nsw`, `california`, `greece`), from `pipeline/07_anomaly.py --preset`. `/anomaly` uses its day-matched 2026-11 row (Nov 1–13). (4 files) |
| `onset_daily_<region>.parquet` | Daily counts per area: `area_id, date, count, source`, used to compute onset. (5 files) |

Not included on purpose: anything from `data/raw/`, `data/interim/`, and intermediate
`clean_*`, `grid_*`, `satfix_*`, `fit_*` files.

## Check values (to confirm you're reading the right files)

- **Punjab + Haryana (`pb_hr`), 1–13 Nov 2026:** 2,913 hotspots vs 20-year median 24,037 → ~12th percentile
  (`anomaly_india.parquet`, `area_id='pb_hr'`, `month='2026-11'`, `month_to_date=true`, `mtd_days=13`).
- **2020 holdout MAPE:** India 11.4%, `pb_hr` 20.8% (`metrics.json`).
