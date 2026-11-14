"""D4 - Fit MODIS -> VIIRS conversion ratios per zone x month-of-year.

Reads data/interim/satfix_<region>.parquet (from 03_satfix.py; one row per
cell x month x family, family = 'modis'|'viirs', mean_count = per-satellite mean)
and writes:

  data/interim/fit_<region>.parquet
      region, zone_id, moy (1-12), ratio, ratio_lo, ratio_hi, level,
      modis_sum, viirs_sum, n_years
  data/interim/cell_zone_<region>.parquet      cell_id, zone_id
  data/interim/fit_report_<region>.json        summary, region ratios, drift

Method
  * Overlap window 2012-02..2026-10, all of 2020 excluded (D5 holdout year, the
    fit must never see it). 2026-11 is excluded (partial month).
  * Zones: each 0.25 deg cell goes to a 2.5 deg block,
    zone_id = floor(lat/2.5)_floor(lon/2.5). India only: Punjab+Haryana
    (lat 27.5-32.5, lon 73.5-77.5) is its own zone 'pb_hr', overriding the block.
  * ratio per zone x moy = sum(viirs mean_count) / sum(modis mean_count) over all
    cells and overlap years of that zone-month (pooled sums, not a mean of cell ratios).
  * Fallback to the region-wide ratio for that moy (level = 'region') when the zone
    has modis_sum < 30, fewer than 5 overlap years with MODIS fires (n_years), or
    viirs_sum == 0 (ratio would be 0). If even the region-wide moy has
    modis_sum < 30, the region's all-months pooled ratio is used (noted in the JSON).
    modis_sum / viirs_sum / n_years always describe the zone's own data, so for
    level = 'region' rows ratio != viirs_sum / modis_sum by design.
  * Uncertainty: bootstrap over years (resample the overlap years of that moy with
    replacement, 500x, seed 375) -> 10th / 90th percentile of the pooled ratio.
    Bounds are widened to include the point estimate when the skewed bootstrap
    distribution leaves it outside [p10, p90] (count reported).
  * Stability (Terra drift): for level = 'zone' rows, linear fit of per-year ratio
    (viirs/modis for each year with MODIS fires) on year, weighted by sqrt(modis
    sum of that year) so near-empty years don't dominate. slope %/yr =
    100 * slope / pooled ratio; |slope| > 3 %/yr is flagged.

Usage:
  python pipeline/04_fit.py                  # all regions with a satfix file
  python pipeline/04_fit.py --region india
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import duckdb
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
INTERIM = REPO_ROOT / "data" / "interim"

OVERLAP_START, OVERLAP_END = "2012-02", "2026-10"
HOLDOUT_YEAR = 2020
ZONE_DEG = 2.5
PB_HR = {"lat": (27.5, 32.5), "lon": (73.5, 77.5)}  # India only
MIN_MODIS_SUM = 30.0
MIN_YEARS = 5
N_BOOT = 500
PCT_LO, PCT_HI = 10, 90
DRIFT_FLAG_PCT = 3.0
SEED = 375
MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()


def q(path: Path) -> str:
    return "'" + str(path).replace("\\", "/").replace("'", "''") + "'"


def available_regions() -> list[str]:
    return sorted(p.stem.removeprefix("satfix_") for p in INTERIM.glob("satfix_*.parquet"))


def zone_sql(region: str) -> str:
    block = (f"CAST(floor(lat / {ZONE_DEG}) AS INTEGER)::VARCHAR || '_' || "
             f"CAST(floor(lon / {ZONE_DEG}) AS INTEGER)::VARCHAR")
    if region != "india":
        return block
    (la0, la1), (lo0, lo1) = PB_HR["lat"], PB_HR["lon"]
    return (f"CASE WHEN lat BETWEEN {la0} AND {la1} AND lon BETWEEN {lo0} AND {lo1} "
            f"THEN 'pb_hr' ELSE {block} END")


def boot_weights(rng: np.random.Generator, n_years: int) -> np.ndarray:
    """(N_BOOT, n_years) matrix: how often each year is drawn in each resample."""
    idx = rng.integers(0, n_years, size=(N_BOOT, n_years))
    return np.stack([np.bincount(row, minlength=n_years) for row in idx]).astype(float)


def boot_bounds(num_b: np.ndarray, den_b: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Percentile bounds of num/den over the bootstrap axis (0); samples with den == 0 skipped."""
    with np.errstate(divide="ignore", invalid="ignore"):
        r = np.where(den_b > 0, num_b / den_b, np.nan)
    ok = ~np.all(np.isnan(r), axis=0)
    lo = np.full(r.shape[1:], np.nan)
    hi = np.full(r.shape[1:], np.nan)
    if ok.any():
        lo[ok], hi[ok] = np.nanpercentile(r[:, ok], [PCT_LO, PCT_HI], axis=0)
    return lo, hi


def fit_region(con: duckdb.DuckDBPyConnection, region: str, rng: np.random.Generator) -> None:
    t0 = time.time()
    src = INTERIM / f"satfix_{region}.parquet"
    out_fit = INTERIM / f"fit_{region}.parquet"
    out_cz = INTERIM / f"cell_zone_{region}.parquet"
    out_json = INTERIM / f"fit_report_{region}.json"
    print(f"\n=== {region.upper()} ===")

    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE cz AS
        SELECT cell_id, {zone_sql(region)} AS zone_id
        FROM (SELECT DISTINCT cell_id, lat, lon FROM read_parquet({q(src)}) WHERE family = 'modis')
    """)
    n_dupe = con.execute("SELECT count(*) - count(DISTINCT cell_id) FROM cz").fetchone()[0]
    assert n_dupe == 0, f"[{region}] {n_dupe} cells map to more than one zone"
    zones = [r[0] for r in con.execute("SELECT DISTINCT zone_id FROM cz ORDER BY 1").fetchall()]
    zi = {z: i for i, z in enumerate(zones)}
    nz = len(zones)

    # zone x moy x year sums over the overlap window (holdout year and partial month excluded)
    rows = con.execute(f"""
        WITH s AS (
            SELECT cell_id, month, family, mean_count FROM read_parquet({q(src)})
            WHERE month BETWEEN '{OVERLAP_START}' AND '{OVERLAP_END}'
              AND CAST(left(month, 4) AS INTEGER) <> {HOLDOUT_YEAR}),
        p AS (
            SELECT m.cell_id, m.month, m.mean_count AS modis, v.mean_count AS viirs
            FROM s m JOIN s v ON m.cell_id = v.cell_id AND m.month = v.month
             AND m.family = 'modis' AND v.family = 'viirs')
        SELECT cz.zone_id, CAST(right(month, 2) AS INTEGER) AS moy,
               CAST(left(month, 4) AS INTEGER) AS year,
               sum(modis)::DOUBLE, sum(viirs)::DOUBLE
        FROM p JOIN cz USING (cell_id) GROUP BY ALL
    """).fetchall()
    assert rows, f"[{region}] no paired MODIS/VIIRS cell-months in the overlap window"
    years_seen = sorted({r[2] for r in rows})
    assert HOLDOUT_YEAR not in years_seen, f"[{region}] holdout year {HOLDOUT_YEAR} leaked into the fit"

    by_moy: dict[int, dict] = {}
    for moy in range(1, 13):
        sub = [r for r in rows if r[1] == moy]
        yrs = sorted({r[2] for r in sub})
        yi = {y: j for j, y in enumerate(yrs)}
        M = np.zeros((nz, len(yrs)))
        V = np.zeros((nz, len(yrs)))
        for z, _, y, m, v in sub:
            M[zi[z], yi[y]] += m
            V[zi[z], yi[y]] += v
        by_moy[moy] = {"years": yrs, "M": M, "V": V}

    # last-resort fallback: region pooled over all months, bootstrapped over calendar years
    all_years = years_seen
    Ma = np.zeros(len(all_years))
    Va = np.zeros(len(all_years))
    for z, _, y, m, v in rows:
        Ma[all_years.index(y)] += m
        Va[all_years.index(y)] += v
    all_ratio = Va.sum() / Ma.sum() if Ma.sum() > 0 else np.nan
    W = boot_weights(rng, len(all_years))
    a_lo, a_hi = boot_bounds((W @ Va)[:, None], (W @ Ma)[:, None])
    all_lo, all_hi = float(a_lo[0]), float(a_hi[0])
    assert np.isfinite(all_ratio) and all_ratio > 0, \
        f"[{region}] region-wide pooled ratio over all months is {all_ratio}; nothing to fall back to"

    out_rows, region_moy, drift, n_widened = [], [], [], 0
    for moy in range(1, 13):
        yrs, M, V = by_moy[moy]["years"], by_moy[moy]["M"], by_moy[moy]["V"]
        W = boot_weights(rng, len(yrs))
        m_sum, v_sum = M.sum(1), V.sum(1)
        n_years = (M > 0).sum(1)

        # region-wide ratio for this moy
        mr, vr = M.sum(0), V.sum(0)
        r_ok = mr.sum() >= MIN_MODIS_SUM and vr.sum() > 0
        if r_ok:
            r_ratio = vr.sum() / mr.sum()
            lo, hi = boot_bounds((W @ vr)[:, None], (W @ mr)[:, None])
            r_lo, r_hi = float(lo[0]), float(hi[0])
            if not np.isfinite(r_lo):
                r_lo = r_hi = r_ratio
        else:
            r_ratio, r_lo, r_hi = all_ratio, all_lo, all_hi
        region_moy.append({"moy": moy, "ratio": r_ratio, "ratio_lo": r_lo, "ratio_hi": r_hi,
                           "modis_sum": float(mr.sum()), "viirs_sum": float(vr.sum()),
                           "basis": "region_moy" if r_ok else "region_all_months"})

        # zone ratios
        with np.errstate(divide="ignore", invalid="ignore"):
            z_ratio = np.where(m_sum > 0, v_sum / m_sum, np.nan)
        z_lo, z_hi = boot_bounds(W @ V.T, W @ M.T)
        zone_ok = (m_sum >= MIN_MODIS_SUM) & (n_years >= MIN_YEARS) & (v_sum > 0)

        for k, z in enumerate(zones):
            if zone_ok[k]:
                ratio, lo, hi, level = z_ratio[k], z_lo[k], z_hi[k], "zone"
                if not np.isfinite(lo):
                    lo = hi = ratio
                if lo > ratio or hi < ratio:
                    n_widened += 1
                lo, hi = min(lo, ratio), max(hi, ratio)
                # drift: weighted fit of per-year ratio on year
                yr_ok = M[k] > 0
                x = np.array(yrs, dtype=float)[yr_ok]
                y = V[k, yr_ok] / M[k, yr_ok]
                slope = np.polyfit(x, y, 1, w=np.sqrt(M[k, yr_ok]))[0]
                slope_pct = 100.0 * slope / ratio
                drift.append({"zone_id": z, "moy": moy, "ratio": float(ratio),
                              "slope_pct_per_yr": float(slope_pct), "n_years": int(n_years[k]),
                              "modis_sum": float(m_sum[k]),
                              "flag": bool(abs(slope_pct) > DRIFT_FLAG_PCT)})
            else:
                ratio, lo, hi, level = r_ratio, r_lo, r_hi, "region"
            out_rows.append((region, z, moy, float(ratio), float(lo), float(hi), level,
                             float(m_sum[k]), float(v_sum[k]), int(n_years[k])))

    # --- asserts -------------------------------------------------------------
    keys = {(r[1], r[2]) for r in out_rows}
    assert len(out_rows) == len(keys) == nz * 12, \
        f"[{region}] expected {nz * 12} zone-months, got {len(out_rows)} rows / {len(keys)} keys"
    for r in out_rows:
        _, z, moy, ratio, lo, hi, *_ = r
        assert np.isfinite(ratio) and ratio > 0, f"[{region}] {z} moy {moy}: ratio {ratio}"
        assert np.isfinite(lo) and np.isfinite(hi), f"[{region}] {z} moy {moy}: bounds {lo}, {hi}"
        assert lo <= ratio <= hi, f"[{region}] {z} moy {moy}: {lo} <= {ratio} <= {hi} fails"

    # --- write ---------------------------------------------------------------
    con.execute("""
        CREATE OR REPLACE TEMP TABLE fit (region VARCHAR, zone_id VARCHAR, moy INTEGER,
            ratio DOUBLE, ratio_lo DOUBLE, ratio_hi DOUBLE, level VARCHAR,
            modis_sum DOUBLE, viirs_sum DOUBLE, n_years INTEGER)
    """)
    con.executemany("INSERT INTO fit VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", out_rows)
    con.execute(f"COPY (SELECT * FROM fit ORDER BY zone_id, moy) TO {q(out_fit)} "
                f"(FORMAT PARQUET, COMPRESSION ZSTD)")
    con.execute(f"COPY (SELECT cell_id, zone_id FROM cz ORDER BY cell_id) TO {q(out_cz)} "
                f"(FORMAT PARQUET, COMPRESSION ZSTD)")

    zone_rows = [r for r in out_rows if r[6] == "zone"]
    n_fallback = len(out_rows) - len(zone_rows)
    flags = [d for d in drift if d["flag"]]
    report = {
        "region": region,
        "overlap": f"{OVERLAP_START}..{OVERLAP_END}",
        "excluded_years": [HOLDOUT_YEAR],
        "years_used": years_seen,
        "zone_deg": ZONE_DEG,
        "special_zones": {"pb_hr": PB_HR} if region == "india" else {},
        "params": {"min_modis_sum": MIN_MODIS_SUM, "min_years_with_fires": MIN_YEARS,
                   "n_boot": N_BOOT, "percentiles": [PCT_LO, PCT_HI], "seed": SEED,
                   "drift_flag_pct_per_yr": DRIFT_FLAG_PCT,
                   "drift_fit": "per-year ratio ~ year, weights sqrt(modis_sum of that year)"},
        "n_cells": int(con.execute("SELECT count(*) FROM cz").fetchone()[0]),
        "n_zones": nz,
        "n_zone_months": len(out_rows),
        "n_zone_level": len(zone_rows),
        "n_region_fallback": n_fallback,
        "n_bounds_widened_to_include_ratio": n_widened,
        "median_zone_ratio": float(np.median([r[3] for r in zone_rows])) if zone_rows else None,
        "region_all_months": {"ratio": all_ratio, "ratio_lo": all_lo, "ratio_hi": all_hi},
        "region_by_moy": region_moy,
        "drift": {"n_tested": len(drift), "n_flagged": len(flags),
                  "flagged": sorted(flags, key=lambda d: -abs(d["slope_pct_per_yr"])),
                  "all": drift},
    }
    if region == "india":
        report["pb_hr_by_moy"] = [
            {"moy": r[2], "ratio": r[3], "ratio_lo": r[4], "ratio_hi": r[5], "level": r[6],
             "modis_sum": r[7], "viirs_sum": r[8], "n_years": r[9]}
            for r in out_rows if r[1] == "pb_hr"]
    out_json.write_text(json.dumps(report, indent=2))

    # --- print ---------------------------------------------------------------
    print(f"  cells={report['n_cells']:,}  zones={nz}  zone-months={len(out_rows)}  "
          f"years={years_seen[0]}..{years_seen[-1]} (n={len(years_seen)}, {HOLDOUT_YEAR} excluded)")
    print(f"  region-wide pooled ratio (all months) = {all_ratio:.2f}  [{all_lo:.2f}, {all_hi:.2f}]")
    print(f"  region ratio by moy: " + "  ".join(
        f"{MONTHS[d['moy'] - 1]} {d['ratio']:.2f}" + ("*" if d["basis"] != "region_moy" else "")
        for d in region_moy))
    if report["median_zone_ratio"] is not None:
        print(f"  median zone ratio = {report['median_zone_ratio']:.2f}")
    print(f"  fell back to region level: {n_fallback} / {len(out_rows)} zone-months "
          f"({100 * n_fallback / len(out_rows):.0f}%)")
    print(f"  bounds widened to include ratio: {n_widened}")
    if region == "india":
        print("  pb_hr (Punjab+Haryana) by month:")
        print(f"    {'moy':<5}{'ratio':>8}{'lo':>8}{'hi':>8}  {'level':<7}{'modis_sum':>11}{'viirs_sum':>11}{'yrs':>5}")
        for d in report["pb_hr_by_moy"]:
            print(f"    {MONTHS[d['moy'] - 1]:<5}{d['ratio']:>8.2f}{d['ratio_lo']:>8.2f}{d['ratio_hi']:>8.2f}  "
                  f"{d['level']:<7}{d['modis_sum']:>11,.0f}{d['viirs_sum']:>11,.0f}{d['n_years']:>5}")
    print(f"  drift: {len(flags)} of {len(drift)} zone-level zone-months with |slope| > {DRIFT_FLAG_PCT}%/yr")
    if flags:
        n_up = sum(d["slope_pct_per_yr"] > 0 for d in flags)
        mass = sum(d["modis_sum"] for d in flags) / max(1e-9, sum(d["modis_sum"] for d in drift))
        print(f"    {n_up} rising / {len(flags) - n_up} falling; flagged zone-months hold "
              f"{100 * mass:.0f}% of zone-level MODIS fires")
    show = report["drift"]["flagged"][:10]
    for d in show:
        print(f"    {d['zone_id']:<8}{MONTHS[d['moy'] - 1]}  slope {d['slope_pct_per_yr']:+6.1f}%/yr  "
              f"ratio {d['ratio']:.2f}  modis_sum {d['modis_sum']:,.0f}  yrs {d['n_years']}")
    if len(show) < len(flags):
        print(f"    ... {len(flags) - len(show)} more in the JSON")
    for p in (out_fit, out_cz, out_json):
        print(f"  -> {p.relative_to(REPO_ROOT)}")
    print(f"  ({time.time() - t0:.0f}s)")


def main() -> None:
    regions = available_regions()
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--region", choices=regions + ["all"], default="all",
                    help="region to process (default: all with a satfix_<region>.parquet)")
    args = ap.parse_args()
    if not regions:
        sys.exit(f"ERROR: no satfix_*.parquet in {INTERIM}; run 03_satfix.py first")

    con = duckdb.connect()
    con.execute(f"SET temp_directory = {q(INTERIM / '.duckdb_tmp')}")
    con.execute("SET enable_progress_bar = false")
    for region in (regions if args.region == "all" else [args.region]):
        fit_region(con, region, np.random.default_rng(SEED))  # per-region seed: same result alone or in 'all'


if __name__ == "__main__":
    main()
