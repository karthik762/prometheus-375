"""D6b - Burning-season onset per year and its shift vs prior years.

Reads data/interim/clean_<region>.parquet + cell_zone/fit (04_fit) through
daily_counts.py and writes

  data/processed/onset_<region>.parquet          one row per area x season year
      area_id, season_year, season_start, season_end, complete, source,
      season_total, n_prior_seasons, threshold, onset_date, onset_day,
      median_prior_onset_day, onset_shift_days, onset_shift_min_days
  data/processed/onset_daily_<region>.parquet    area_id, date, count, source

Daily counts: per-satellite average over the satellites active that day, MODIS
converted with the D4 ratio for the zone and that month (see daily_counts.py).
Daily file: VIIRS where a VIIRS satellite is active that day, else converted MODIS.
Within one season the source is fixed: VIIRS if a VIIRS satellite is active on
every season day (up to the data end), otherwise converted MODIS for the whole
season, so the cumulative curve never mixes scales.

Season:
  pb_hr       Sep 15 -> Dec 31 (paddy stubble).
  elsewhere   the 4 consecutive calendar months (may wrap the year end) with the
              largest sum of monthly medians over 2001..2025. Seasons that wrap
              are labelled by the year they start.

Onset of season Y = first day the cumulative count reaches 10% of the median
season total of all earlier complete seasons (so a partial 2026 season works).
onset_day = days since season start (0 = first day). onset_shift_days =
onset_day - median onset_day of earlier seasons (negative = earlier).
Null when there is no earlier complete season or the threshold is not reached yet.
For a partial season that has not reached the threshold, onset_shift_min_days =
(days of data so far) - median onset_day: the onset can only be later than that.

Usage:
  python pipeline/08_onset.py                  # all regions with a clean + fit file
  python pipeline/08_onset.py --region india
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys
import time

import duckdb
import numpy as np

from daily_counts import INTERIM, PROCESSED, REPO_ROOT, areas, build_daily, data_end, q, sat_windows

ONSET_FRAC = 0.10
SEASON_MONTHS = 4
MEDIAN_YEARS = (2001, 2025)
FIXED_SEASONS = {"pb_hr": ((9, 15), (12, 31))}
MIN_PRIOR = 5
FEATURE_AREA = "pb_hr"
MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()


def available_regions() -> list[str]:
    have = lambda p: {f.stem.removeprefix(p) for f in INTERIM.glob(f"{p}*.parquet")}
    return sorted(have("clean_") & have("fit_") & have("cell_zone_"))


def month_end(y: int, m: int) -> dt.date:
    return (dt.date(y + m // 12, m % 12 + 1, 1) - dt.timedelta(days=1))


def pick_season(con: duckdb.DuckDBPyConnection, area: str) -> tuple[tuple, list[float]]:
    """4 consecutive months (circular) with the largest summed monthly median."""
    rows = con.execute(f"""
        SELECT month(d) AS moy, year(d) AS y,
               sum(CASE WHEN n_viirs > 0 THEN viirs ELSE modis_conv END) AS tot
        FROM daily WHERE area_id = '{area}' AND year(d) BETWEEN {MEDIAN_YEARS[0]} AND {MEDIAN_YEARS[1]}
        GROUP BY ALL
    """).fetchall()
    med = [float(np.median([t for m, _, t in rows if m == moy])) for moy in range(1, 13)]
    best = max(range(12), key=lambda s: sum(med[(s + k) % 12] for k in range(SEASON_MONTHS)))
    sm, em = best + 1, (best + SEASON_MONTHS - 1) % 12 + 1
    return ((sm, 1), (em, None)), med  # None = last day of that month


def onset_region(con: duckdb.DuckDBPyConnection, region: str, windows: dict, end: dt.date) -> None:
    t0 = time.time()
    out = PROCESSED / f"onset_{region}.parquet"
    out_daily = PROCESSED / f"onset_daily_{region}.parquet"
    build_daily(con, region, windows, end)
    first_day = con.execute("SELECT min(d) FROM daily").fetchone()[0]

    bad = con.execute("""
        SELECT count(*) FROM daily
        WHERE (n_modis > 0 AND (modis_conv IS NULL OR isnan(modis_conv) OR modis_conv < 0))
           OR (n_viirs > 0 AND (viirs IS NULL OR isnan(viirs) OR viirs < 0))
    """).fetchone()[0]
    assert bad == 0, f"[{region}] {bad:,} active days with NaN / negative counts"

    con.execute(f"""
        COPY (SELECT area_id, d AS date,
                     CASE WHEN n_viirs > 0 THEN viirs ELSE modis_conv END AS count,
                     CASE WHEN n_viirs > 0 THEN 'viirs' ELSE 'modis_converted' END AS source
              FROM daily ORDER BY area_id, d)
        TO {q(out_daily)} (FORMAT PARQUET, COMPRESSION ZSTD)
    """)

    rows, seasons_used = [], {}
    for area, _ in areas(region):
        if area in FIXED_SEASONS:
            spec, med = FIXED_SEASONS[area], None
        else:
            spec, med = pick_season(con, area)
        seasons_used[area] = (spec, med)
        d, nv, v, m = map(np.array, zip(*con.execute(
            f"SELECT d, n_viirs, viirs, modis_conv FROM daily WHERE area_id = '{area}' ORDER BY d"
        ).fetchall()))
        idx = {day: i for i, day in enumerate(d)}

        hist = []  # (season_year, total, onset_day) of complete seasons so far
        onsets = []  # onset_day of earlier seasons (any completeness, onset found)
        for y in range(first_day.year - 1, end.year + 1):
            (sm, sd), (em, ed) = spec
            start = dt.date(y, sm, sd)
            stop_y = y + (em < sm)  # season wraps the year end
            stop = month_end(stop_y, em) if ed is None else dt.date(stop_y, em, ed)
            if start < first_day or start > end:
                continue
            complete = stop <= end
            i0, i1 = idx[start], idx[min(stop, end)]
            use_viirs = bool(np.all(nv[i0:i1 + 1] > 0))
            series = (v if use_viirs else m)[i0:i1 + 1].astype(float)
            assert not np.isnan(series).any(), f"[{region}] {area} {y}: NaN in season series"
            cum = np.cumsum(series)
            total = float(cum[-1])

            prior_tot = [t for _, t in hist]
            threshold = ONSET_FRAC * float(np.median(prior_tot)) if prior_tot else None
            onset_day = None
            if threshold and threshold > 0:
                hit = np.nonzero(cum >= threshold)[0]
                onset_day = int(hit[0]) if hit.size else None
            med_prior = float(np.median(onsets)) if onsets else None
            shift = (onset_day - med_prior) if (onset_day is not None and med_prior is not None) else None
            # Partial season, threshold not reached yet: onset is at least the day after the
            # last data day, so the shift is at least this (null otherwise).
            shift_min = None
            if not complete and onset_day is None and threshold and med_prior is not None:
                shift_min = ((end - start).days + 1) - med_prior
            rows.append(dict(
                area_id=area, season_year=y, season_start=start, season_end=stop, complete=complete,
                source="viirs" if use_viirs else "modis_converted", season_total=total,
                n_prior_seasons=len(prior_tot), threshold=threshold,
                onset_date=start + dt.timedelta(days=onset_day) if onset_day is not None else None,
                onset_day=onset_day, median_prior_onset_day=med_prior, onset_shift_days=shift,
                onset_shift_min_days=shift_min))
            if complete:
                hist.append((y, total))
                if onset_day is not None:
                    onsets.append(onset_day)

    # --- asserts --------------------------------------------------------------
    for r in rows:
        tag = f"[{region}] {r['area_id']} {r['season_year']}"
        if r["onset_day"] is not None:
            assert r["season_start"] <= r["onset_date"] <= min(r["season_end"], end), tag
            if r["median_prior_onset_day"] is not None:
                assert r["onset_shift_days"] is not None and np.isfinite(r["onset_shift_days"]), tag
        if r["n_prior_seasons"] >= MIN_PRIOR:
            assert r["threshold"] is not None and np.isfinite(r["threshold"]), tag
        assert np.isfinite(r["season_total"]) and r["season_total"] >= 0, tag
    assert len({(r["area_id"], r["season_year"]) for r in rows}) == len(rows)

    cols = ["area_id", "season_year", "season_start", "season_end", "complete", "source",
            "season_total", "n_prior_seasons", "threshold", "onset_date", "onset_day",
            "median_prior_onset_day", "onset_shift_days", "onset_shift_min_days"]
    con.execute("""
        CREATE OR REPLACE TEMP TABLE ons (area_id VARCHAR, season_year INTEGER, season_start DATE,
            season_end DATE, complete BOOLEAN, source VARCHAR, season_total DOUBLE,
            n_prior_seasons INTEGER, threshold DOUBLE, onset_date DATE, onset_day INTEGER,
            median_prior_onset_day DOUBLE, onset_shift_days DOUBLE, onset_shift_min_days DOUBLE)
    """)
    con.executemany(f"INSERT INTO ons VALUES ({', '.join('?' * len(cols))})",
                    [[r[c] for c in cols] for r in rows])
    con.execute(f"COPY (SELECT * FROM ons ORDER BY area_id, season_year) TO {q(out)} "
                f"(FORMAT PARQUET, COMPRESSION ZSTD)")

    # --- print ----------------------------------------------------------------
    print(f"\n=== {region.upper()} ===  -> {out.relative_to(REPO_ROOT)}, "
          f"{out_daily.relative_to(REPO_ROOT)}  ({time.time() - t0:.0f}s)")
    for area, (spec, med) in sorted(seasons_used.items(), key=lambda kv: kv[0] != FEATURE_AREA):
        (sm, sd), (em, ed) = spec
        how = "fixed" if med is None else "4 peak months by median"
        last = [r for r in rows if r["area_id"] == area][-1]
        os_ = (f"onset {last['onset_date']} (day {last['onset_day']}), shift "
               f"{last['onset_shift_days']:+.0f} d vs median day {last['median_prior_onset_day']:.0f}"
               if last["onset_shift_days"] is not None else
               (f"onset not reached yet (cum {last['season_total']:,.0f} < threshold {last['threshold']:,.0f}); "
                f"shift >= {last['onset_shift_min_days']:+.0f} d vs median day {last['median_prior_onset_day']:.0f}"
                if last["onset_shift_min_days"] is not None else
                "onset not reached" if last["threshold"] else "no onset (no prior seasons)"))
        state = "complete" if last["complete"] else f"partial to {end}"
        print(f"  {area:<10} season {MONTHS[sm - 1]} {sd} -> {MONTHS[em - 1]} {ed or 'end'} ({how}); "
              f"{last['season_year']} ({state}, {last['source']}): {os_}")
    if region == "india":
        print(f"  {FEATURE_AREA} by season (threshold = 10% of median prior complete season total):")
        print(f"    {'year':<6}{'src':<6}{'total':>10}{'thresh':>9}  {'onset':<11}{'day':>4}{'med':>6}{'shift':>7}")
        for r in rows:
            if r["area_id"] != FEATURE_AREA:
                continue
            fmt = lambda x, s: "" if x is None else format(x, s)
            print(f"    {r['season_year']:<6}{'V' if r['source'] == 'viirs' else 'M':<6}"
                  f"{r['season_total']:>10,.0f}{fmt(r['threshold'], '>9,.0f'):>9}  "
                  f"{str(r['onset_date'] or '-'):<11}{fmt(r['onset_day'], '>4'):>4}"
                  f"{fmt(r['median_prior_onset_day'], '>6.0f'):>6}{fmt(r['onset_shift_days'], '>+7.0f'):>7}"
                  + ("" if r["complete"] else "  (partial)"))


def main() -> None:
    regions = available_regions()
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--region", choices=regions + ["all"], default="all",
                    help="region to process (default: all with clean + fit + cell_zone files)")
    args = ap.parse_args()
    if not regions:
        sys.exit(f"ERROR: no region has clean + fit + cell_zone files in {INTERIM}")
    PROCESSED.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect()
    con.execute(f"SET temp_directory = {q(INTERIM / '.duckdb_tmp')}")
    con.execute("SET enable_progress_bar = false")
    windows = sat_windows(con)
    end = data_end(windows)
    print(f"data end N = {end} (last day all non-retired satellites have data)")
    for region in (regions if args.region == "all" else [args.region]):
        onset_region(con, region, windows, end)


if __name__ == "__main__":
    main()
