"""D5b - Validate the MODIS -> VIIRS conversion on a held-out year.

Reads data/interim/satfix_<region>.parquet, fit_<region>.parquet,
cell_zone_<region>.parquet, fit_report_<region>.json, grid_<region>.parquet and
data/processed/harmonized_<region>.parquet (from 05_series.py). Writes

  data/processed/metrics.json
  data/processed/before_after.parquet     cell_id, month, raw, harmonized

Holdout: 2020. 04_fit.py never saw it, and both families are complete that year.
For each 2020 cell-month with both families:
    predicted = modis mean_count * ratio(zone, moy)
    actual    = viirs mean_count
    baseline  = modis mean_count * one region-wide ratio (fit_report
                region_all_months: pooled over all months and zones, same
                training years), to show what zone x month adds.
Sums are taken to zone x month and to region x month, then
    MAE  = mean |predicted - actual|                          (counts)
    MAPE = mean |predicted - actual| / actual * 100           (%), only over
           months with actual >= 10; the number used is reported.
    bias = sum(predicted) / sum(actual) - 1                   (%)
India also gets pb_hr (Punjab + Haryana) month by month.

Top-level mae / mape (the /validation contract fields) are India region-month;
every region is under "regions".

before_after.parquet is cell-level so /validation can filter by polygon:
    raw        = sum of all satellites' n_hotspots in the grid (Terra + Aqua +
                 SNPP + NOAA-20 + NOAA-21, partial months included), which
                 jumps whenever a satellite joins.
    harmonized = harmonized_count from 05_series.

Usage:
  python pipeline/06_validate.py                  # all regions
  python pipeline/06_validate.py --region india   # metrics.json / before_after
                                                  # still cover only that region
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import duckdb

REPO_ROOT = Path(__file__).resolve().parents[1]
INTERIM = REPO_ROOT / "data" / "interim"
PROCESSED = REPO_ROOT / "data" / "processed"

HOLDOUT_YEAR = 2020
MAPE_MIN_ACTUAL = 10.0
SHOW_REGION = "india"  # top-level mae/mape
PRINT_WINDOWS = [("2010-01", "2014-12", "SNPP joins 2012-01 (first full month 2012-02)"),
                 ("2017-01", "2019-12", "NOAA-20 joins 2018-04")]


def q(path: Path) -> str:
    return "'" + str(path).replace("\\", "/").replace("'", "''") + "'"


def available_regions() -> list[str]:
    return sorted(p.stem.removeprefix("harmonized_") for p in PROCESSED.glob("harmonized_*.parquet")
                  if p.stem != "harmonized_nonzero")


def errors(con: duckdb.DuckDBPyConnection, table: str, pred: str) -> dict:
    """MAE / MAPE / bias of `pred` vs actual over all rows of `table`."""
    n, mae, n_mape, mape, sp, sa = con.execute(f"""
        SELECT count(*), avg(abs({pred} - actual)),
               count(*) FILTER (WHERE actual >= {MAPE_MIN_ACTUAL}),
               100 * avg(abs({pred} - actual) / actual) FILTER (WHERE actual >= {MAPE_MIN_ACTUAL}),
               sum({pred}), sum(actual)
        FROM {table}
    """).fetchone()
    return {"n": n, "mae": mae, "mape": mape, "n_mape": n_mape,
            "bias_pct": 100 * (sp / sa - 1) if sa else None,
            "sum_predicted": sp, "sum_actual": sa}


def pct_better(model: float | None, base: float | None) -> float | None:
    if model is None or base is None or base == 0:
        return None
    return 100 * (1 - model / base)


def validate_region(con: duckdb.DuckDBPyConnection, region: str) -> dict:
    sf, fit, cz = (INTERIM / f"{p}_{region}.parquet" for p in ("satfix", "fit", "cell_zone"))
    report = json.loads((INTERIM / f"fit_report_{region}.json").read_text())
    assert HOLDOUT_YEAR in report["excluded_years"], \
        f"[{region}] fit_report says {HOLDOUT_YEAR} was not held out: {report['excluded_years']}"
    assert HOLDOUT_YEAR not in report["years_used"], f"[{region}] {HOLDOUT_YEAR} in fit years_used"
    global_ratio = report["region_all_months"]["ratio"]

    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE cell AS
        WITH s AS (SELECT * FROM read_parquet({q(sf)}) WHERE left(month, 4) = '{HOLDOUT_YEAR}'),
             z AS (SELECT * FROM read_parquet({q(cz)})),
             f AS (SELECT * FROM read_parquet({q(fit)}))
        SELECT m.cell_id, m.month, z.zone_id, f.ratio,
               m.mean_count * f.ratio AS predicted,
               m.mean_count * {global_ratio} AS baseline,
               v.mean_count AS actual
        FROM s m
        JOIN s v ON v.cell_id = m.cell_id AND v.month = m.month AND v.family = 'viirs'
        JOIN z ON z.cell_id = m.cell_id
        JOIN f ON f.zone_id = z.zone_id AND f.moy = CAST(right(m.month, 2) AS INTEGER)
        WHERE m.family = 'modis'
    """)
    n_cell, n_months, n_modis = con.execute(f"""
        SELECT (SELECT count(*) FROM cell), (SELECT count(DISTINCT month) FROM cell),
               (SELECT count(*) FROM read_parquet({q(sf)})
                WHERE family = 'modis' AND left(month, 4) = '{HOLDOUT_YEAR}')
    """).fetchone()
    assert n_months == 12, f"[{region}] holdout has {n_months} months with both families, expected 12"
    assert n_cell == n_modis, f"[{region}] {n_modis - n_cell:,} 2020 MODIS cell-months lost in the join"

    con.execute("""
        CREATE OR REPLACE TEMP TABLE zm AS
        SELECT zone_id, month, sum(predicted) AS predicted, sum(baseline) AS baseline,
               sum(actual) AS actual FROM cell GROUP BY ALL
    """)
    con.execute("""
        CREATE OR REPLACE TEMP TABLE rm AS
        SELECT month, sum(predicted) AS predicted, sum(baseline) AS baseline,
               sum(actual) AS actual FROM cell GROUP BY ALL
    """)

    out = {"global_ratio": global_ratio, "n_cell_months": n_cell}
    for level, table in (("region_month", "rm"), ("zone_month", "zm")):
        model, base = errors(con, table, "predicted"), errors(con, table, "baseline")
        out[level] = {
            "mae": model["mae"], "mape": model["mape"],
            "n": model["n"], "n_mape": model["n_mape"], "bias_pct": model["bias_pct"],
            "baseline_global_ratio": {k: base[k] for k in ("mae", "mape", "bias_pct")},
            "improvement_pct": {"mae": pct_better(model["mae"], base["mae"]),
                                "mape": pct_better(model["mape"], base["mape"])},
        }
    out["region_month"]["monthly"] = [
        {"month": m, "actual": a, "predicted": p, "baseline": b}
        for m, a, p, b in con.execute(
            "SELECT month, actual, predicted, baseline FROM rm ORDER BY month").fetchall()]

    if region == "india":
        rows = con.execute("""
            SELECT zm.month, zm.actual, zm.predicted, zm.baseline, any_value(c.ratio)
            FROM zm JOIN cell c USING (zone_id, month)
            WHERE zm.zone_id = 'pb_hr' GROUP BY ALL ORDER BY zm.month
        """).fetchall()
        assert len(rows) == 12, f"[india] pb_hr has {len(rows)} holdout months"
        out["pb_hr_monthly"] = [
            {"month": m, "actual": a, "predicted": p, "baseline": b, "ratio": r,
             "abs_err": abs(p - a), "pct_err": 100 * (p - a) / a if a >= MAPE_MIN_ACTUAL else None}
            for m, a, p, b, r in rows]
        con.execute("CREATE OR REPLACE TEMP TABLE pb AS SELECT * FROM zm WHERE zone_id = 'pb_hr'")
        pm, pbase = errors(con, "pb", "predicted"), errors(con, "pb", "baseline")
        out["pb_hr"] = {"mae": pm["mae"], "mape": pm["mape"], "n_mape": pm["n_mape"],
                        "bias_pct": pm["bias_pct"],
                        "baseline_global_ratio": {k: pbase[k] for k in ("mae", "mape", "bias_pct")}}
    return out


def fmt(x: float | None, spec: str) -> str:
    return "n/a" if x is None else format(x, spec)


def print_region(region: str, r: dict) -> None:
    print(f"\n=== {region.upper()} ===  holdout {HOLDOUT_YEAR}: {r['n_cell_months']:,} cell-months, "
          f"global ratio {r['global_ratio']:.2f}")
    print(f"  {'level':<14}{'MAE':>12}{'MAPE%':>8}{'n_mape':>11}{'bias%':>8}   "
          f"{'base MAE':>11}{'base MAPE%':>11}   {'MAE better':>10}{'MAPE better':>12}")
    for level in ("region_month", "zone_month"):
        d, b, imp = r[level], r[level]["baseline_global_ratio"], r[level]["improvement_pct"]
        print(f"  {level:<14}{d['mae']:>12,.1f}{fmt(d['mape'], '>8.1f')} "
              f"{str(d['n_mape']) + '/' + str(d['n']):>11}{fmt(d['bias_pct'], '>+8.1f')}   "
              f"{b['mae']:>11,.1f}{fmt(b['mape'], '>11.1f')}   "
              f"{fmt(imp['mae'], '>+9.0f')}%{fmt(imp['mape'], '>+11.0f')}%")
    if "pb_hr_monthly" in r:
        p = r["pb_hr"]
        print(f"  pb_hr (Punjab+Haryana) {HOLDOUT_YEAR}: MAE {p['mae']:,.1f}  MAPE "
              f"{fmt(p['mape'], '.1f')}% (n={p['n_mape']})  bias {fmt(p['bias_pct'], '+.1f')}%   "
              f"[global ratio: MAE {p['baseline_global_ratio']['mae']:,.1f}  "
              f"MAPE {fmt(p['baseline_global_ratio']['mape'], '.1f')}%]")
        print(f"    {'month':<9}{'actual':>10}{'predicted':>11}{'baseline':>10}{'ratio':>7}{'err%':>8}")
        for d in r["pb_hr_monthly"]:
            print(f"    {d['month']:<9}{d['actual']:>10,.1f}{d['predicted']:>11,.1f}"
                  f"{d['baseline']:>10,.1f}{d['ratio']:>7.2f}{fmt(d['pct_err'], '>+8.1f')}")


def build_before_after(con: duckdb.DuckDBPyConnection, regions: list[str]) -> Path:
    out = PROCESSED / "before_after.parquet"
    grids = "[" + ", ".join(q(INTERIM / f"grid_{r}.parquet") for r in regions) + "]"
    harms = "[" + ", ".join(q(PROCESSED / f"harmonized_{r}.parquet") for r in regions) + "]"
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE ba AS
        WITH raw AS (SELECT cell_id, month, sum(n_hotspots)::DOUBLE AS raw
                     FROM read_parquet({grids}) GROUP BY ALL),
             h AS (SELECT cell_id, month, harmonized_count AS harmonized FROM read_parquet({harms}))
        SELECT cell_id, month, coalesce(raw.raw, 0)::DOUBLE AS raw, h.harmonized::DOUBLE AS harmonized,
               raw.cell_id IS NULL AS _no_raw
        FROM h LEFT JOIN raw USING (cell_id, month)
    """)
    n, no_raw, dupes = con.execute("""
        SELECT count(*), count(*) FILTER (WHERE _no_raw),
               count(*) - count(DISTINCT (cell_id, month)) FROM ba
    """).fetchone()
    assert dupes == 0, f"before_after: {dupes:,} duplicate (cell_id, month)"
    assert no_raw == 0, f"before_after: {no_raw:,} harmonized cell-months with no grid rows"
    raw_ba, raw_grid = con.execute(f"""
        SELECT (SELECT sum(raw) FROM ba), (SELECT sum(n_hotspots)::DOUBLE FROM read_parquet({grids}))
    """).fetchone()
    assert raw_ba == raw_grid, f"before_after raw sum {raw_ba:,.0f} != grid hotspots {raw_grid:,.0f}"
    con.execute(f"COPY (SELECT cell_id, month, raw, harmonized FROM ba ORDER BY cell_id, month) "
                f"TO {q(out)} (FORMAT PARQUET, COMPRESSION ZSTD)")
    print(f"\n  before_after: rows={n:,}  raw total={raw_ba:,.0f} (== grid)  "
          f"-> {out.relative_to(REPO_ROOT)}  {out.stat().st_size / 1e6:.1f} MB")
    return out


def print_india_jumps(con: duckdb.DuckDBPyConnection) -> None:
    grid = INTERIM / "grid_india.parquet"
    harm = PROCESSED / "harmonized_india.parquet"
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE nat AS
        WITH r AS (SELECT month, sum(n_hotspots)::DOUBLE AS raw,
                          string_agg(DISTINCT satellite, '+' ORDER BY satellite) AS sats
                   FROM read_parquet({q(grid)}) WHERE n_hotspots > 0 GROUP BY month),
             h AS (SELECT month, sum(harmonized_count) AS harmonized, any_value(source) AS source
                   FROM read_parquet({q(harm)}) GROUP BY month)
        SELECT month, raw, harmonized, source, sats FROM h LEFT JOIN r USING (month)
    """)
    print("\n=== INDIA national totals: raw (sum of all satellites) vs harmonized ===")
    print("  raw/harm should step ~0.2 -> ~1.2 at 2012-02 and -> ~2.2 at 2018-04 "
          "(raw adds a satellite; harmonized stays on one-VIIRS scale)")
    for start, end, label in PRINT_WINDOWS:
        print(f"\n  -- {start}..{end}: {label} --")
        print(f"  {'month':<9}{'raw':>10}{'harmonized':>12}{'raw/harm':>10}  {'source':<16}sats")
        for m, raw, h, src, sats in con.execute(f"""
            SELECT month, coalesce(raw, 0), harmonized, source, sats FROM nat
            WHERE month BETWEEN '{start}' AND '{end}' ORDER BY month
        """).fetchall():
            ratio = f"{raw / h:10.2f}" if h else "       n/a"
            print(f"  {m:<9}{raw:>10,.0f}{h:>12,.0f}{ratio}  {src:<16}{sats or ''}")
    print("\n  annual totals (YoY change):")
    print(f"  {'year':<6}{'raw':>11}{'YoY':>8}{'harmonized':>13}{'YoY':>8}")
    prev = None
    for y, raw, h in con.execute("""
        SELECT left(month, 4) AS y, sum(coalesce(raw, 0)), sum(harmonized) FROM nat
        WHERE month BETWEEN '2009-01' AND '2019-12' GROUP BY 1 ORDER BY 1
    """).fetchall():
        yr = f"{100 * (raw / prev[0] - 1):+7.0f}%" if prev else " " * 8
        yh = f"{100 * (h / prev[1] - 1):+7.0f}%" if prev else " " * 8
        print(f"  {y:<6}{raw:>11,.0f}{yr}{h:>13,.0f}{yh}")
        prev = (raw, h)
    # Quantify the step: median raw/harm in each regime (season-independent).
    regimes = [("2010-01", "2012-01", "MODIS only (pre-SNPP)"),
               ("2012-02", "2018-03", "MODIS + SNPP"),
               ("2018-04", "2019-12", "MODIS + SNPP + NOAA-20")]
    print("\n  median raw/harmonized by regime:")
    for a, b, lab in regimes:
        med = con.execute(f"""
            SELECT median(raw / harmonized) FROM nat
            WHERE month BETWEEN '{a}' AND '{b}' AND harmonized > 0
        """).fetchone()[0]
        print(f"    {a}..{b}  {med:5.2f}  {lab}")


def main() -> None:
    regions = available_regions()
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--region", choices=regions + ["all"], default="all",
                    help="region to validate (default: all with a harmonized_<region>.parquet)")
    args = ap.parse_args()
    if not regions:
        sys.exit(f"ERROR: no harmonized_*.parquet in {PROCESSED}; run 05_series.py first")
    run = regions if args.region == "all" else [args.region]

    t0 = time.time()
    con = duckdb.connect()
    con.execute(f"SET temp_directory = {q(INTERIM / '.duckdb_tmp')}")
    con.execute("SET enable_progress_bar = false")

    results = {}
    for region in run:
        results[region] = validate_region(con, region)
        print_region(region, results[region])

    top = results.get(SHOW_REGION) or results[run[0]]
    top_name = SHOW_REGION if SHOW_REGION in results else run[0]
    metrics = {
        "holdout_year": HOLDOUT_YEAR,
        "mae": top["region_month"]["mae"],
        "mape": top["region_month"]["mape"],
        "mae_mape_basis": f"{top_name} region x month, {HOLDOUT_YEAR} sums of predicted vs actual "
                          f"VIIRS-scale counts",
        "units": {"mae": "hotspots per month (one-VIIRS-satellite scale)", "mape": "percent"},
        "mape_min_actual": MAPE_MIN_ACTUAL,
        "baseline": "one region-wide MODIS->VIIRS ratio (all months, all zones, same training years)",
        "regions": results,
    }
    if "india" in results:
        metrics["pb_hr_monthly"] = results["india"]["pb_hr_monthly"]
    out = PROCESSED / "metrics.json"
    out.write_text(json.dumps(metrics, indent=2))
    print(f"\n  -> {out.relative_to(REPO_ROOT)}")

    build_before_after(con, run)
    if "india" in run:
        print_india_jumps(con)
    print(f"\n  ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
