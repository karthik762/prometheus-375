# Role: Data lead — Rishitha
Paste after AGENTS.md. You own `/pipeline` and the parquet outputs everyone depends on.

## Your AI's job
Help write a reproducible Python pipeline (pandas/polars + pyarrow, scipy for fits). Prefer simple, vectorized code. Every step writes an intermediate parquet so it can be resumed.

## Tasks (in order)
1. **By 10:00** — `data-sample/harmonized_sample.parquet` + `.csv`: ~2 years × Punjab bbox, fake counts, exact contract columns. Push immediately; app pair is blocked on it.
2. Earthdata login + FIRMS MAP_KEY → share key privately with backend member.
3. `pipeline/01_clean.py` — type==0, confidence filters, unify columns across MODIS/VIIRS CSVs.
4. `pipeline/02_grid.py` — 0.25° cell × month × satellite counts.
5. `pipeline/03_satfix.py` — per-satellite average per family; check S-NPP vs NOAA-20/21 agreement on overlap.
6. `pipeline/04_fit.py` — MODIS→VIIRS ratio (or log regression) per region × month-of-year on 2012–2026; pool sparse cells.
7. `pipeline/05_series.py` — 2000–2011 converted, 2012+ real VIIRS, with `uncertainty`.
8. `pipeline/06_validate.py` — hold out 2020, write `metrics.json` (mae, mape) + before/after series.
9. Repeat 3–8 for Amazon, California, Australia, Indonesia.

**Fallback if behind at 20:00:** one ratio per month-of-year for Punjab/Haryana only.

## Hand-offs
- To backend: `harmonized.parquet`, `metrics.json`, `before_after.parquet` at agreed path `backend/data/`.
- To data analyst: monthly series per region for anomaly + onset work.
