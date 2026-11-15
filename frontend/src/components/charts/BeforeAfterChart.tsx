import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { useValidation } from '../../hooks/useValidation';
import { formatCount, formatMonthShort } from '../../lib/format';
import { LoadingState, ComingSoonState, ErrorState, EmptyState } from '../ui/States';
import { SampleDataBadge } from '../ui/SampleDataBadge';
import { DownloadPngButton } from '../ui/DownloadPngButton';
import { beforeAfterToCanvas, downloadCanvas, pngFilename } from '../../lib/exportPng';

// /validation is the 2020 holdout for the India preset only
const VALIDATION_AREA = 'Punjab & Haryana (India)';
const VALIDATION_AREA_ID = 'punjab_haryana';
// PNG is rendered from a hidden fixed-size chart, so it looks the same from a phone or a desktop
const EXPORT_W = 1200;
const EXPORT_H = 420;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
};

// Solid dot for complete months, hollow dot for a partial (month-to-date) month.
const makeDot = (color: string, r: number) => (props: any) => {
  const { cx, cy, payload, index } = props;
  if (cx == null || cy == null) return <g key={`d-${index}`} />;
  return payload?.partial ? (
    <circle key={`d-${index}`} cx={cx} cy={cy} r={r + 1.5} fill="var(--color-bg-surface)" stroke={color} strokeWidth={1.5} />
  ) : (
    <circle key={`d-${index}`} cx={cx} cy={cy} r={r} fill={color} />
  );
};

interface ProofChartProps {
  data: any[];
  partialNote: string | null;
  /** Fixed-size render for PNG export: no tooltip, no HTML legend, no animation. */
  exportMode?: boolean;
  /** Injected by ResponsiveContainer on screen; explicit for export. */
  width?: number;
  height?: number;
}

const ProofChart: React.FC<ProofChartProps> = ({ data, partialNote, exportMode = false, width, height }) => (
    <ComposedChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 10, right: 20, left: 20, bottom: 10 }}
    >
      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" vertical={false} />
      <XAxis
        dataKey="monthFormatted"
        stroke="var(--color-text-tertiary)"
        fontSize={11}
        tickLine={false}
        dy={6}
      />
      <YAxis
        stroke="var(--color-text-tertiary)"
        fontSize={11}
        tickLine={false}
        tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`}
      />
      {!exportMode && <Tooltip
        content={({ active, payload }) => {
          if (active && payload && payload.length) {
            const item = payload[0].payload;
            return (
              <div
                className="editorial-tooltip"
                style={{
                  backgroundColor: 'rgba(16, 18, 30, 0.96)',
                  border: '1px solid var(--color-gold)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px 12px',
                  fontSize: '0.75rem',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
                }}
              >
                <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '4px' }}>
                  {item.month}
                </div>
                <div style={{ color: '#8c92a8', display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                  <span>Raw Sensor Hotspots:</span>
                  <strong style={{ fontFamily: 'var(--font-mono)' }}>{formatCount(item.raw)}</strong>
                </div>
                <div style={{ color: 'var(--color-gold)', display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                  <span>Harmonized VIIRS-Eq:</span>
                  <strong style={{ fontFamily: 'var(--font-mono)' }}>{formatCount(item.harmonized)}</strong>
                </div>
                {item.partial && partialNote && (
                  <div style={{ color: '#8c92a8', marginTop: '4px', fontStyle: 'italic' }}>
                    {partialNote}
                  </div>
                )}
              </div>
            );
          }
          return null;
        }}
      />}
      {!exportMode && (
        <Legend
          verticalAlign="top"
          formatter={(val) => (
            <span style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>{val}</span>
          )}
        />
      )}

      {/* Bootstrap 80% uncertainty range (p10–p90); only MODIS-estimated months carry one */}
      <Area
        type="monotone"
        dataKey="uncertaintyBand"
        name="Uncertainty (80% range, MODIS-estimated years)"
        fill="rgba(184, 156, 107, 0.12)"
        stroke="none"
        isAnimationActive={!exportMode}
        animationDuration={500}
        animationEasing="ease-out"
      />

      {/* Raw unadjusted line (jumps in 2012) */}
      <Line
        type="monotone"
        dataKey="raw"
        name="Raw Sensor Count (Cliff at 2012)"
        stroke="#5f677a"
        strokeWidth={1.5}
        strokeDasharray="4 4"
        dot={makeDot('#5f677a', 2.5)}
        isAnimationActive={!exportMode}
        animationDuration={500}
        animationEasing="ease-out"
      />

      {/* Harmonized series (continuous) */}
      <Line
        type="monotone"
        dataKey="harmonizedFull"
        name="Prometheus 375 Harmonized"
        stroke="var(--color-gold)"
        strokeWidth={2.5}
        dot={{ r: 3, fill: 'var(--color-gold)' }}
        isAnimationActive={!exportMode}
        animationDuration={500}
        animationEasing="ease-out"
      />

      {/* Partial (month-to-date) segment: dashed with hollow end dot */}
      <Line
        type="monotone"
        dataKey="harmonizedPartial"
        name="Month to date (partial)"
        legendType="none"
        stroke="var(--color-gold)"
        strokeWidth={2}
        strokeDasharray="5 4"
        dot={(props: any) =>
          props.payload?.partial ? makeDot('var(--color-gold)', 3)(props) : <g key={`p-${props.index}`} />
        }
        connectNulls={false}
        isAnimationActive={!exportMode}
        animationDuration={500}
        animationEasing="ease-out"
      />
    </ComposedChart>
);

export const BeforeAfterChart: React.FC = () => {
  const { data, isMock, loading, error } = useValidation();

  // Prepare data with uncertainty bounds formatted for Area chart.
  // Band only where the API supplies a non-zero lo/hi range (MODIS-estimated years); otherwise null = no band.
  // Partial (month-to-date) rows are drawn as a separate dashed segment with hollow dots.
  const chartData = React.useMemo(() => {
    if (!data?.before_after) return [];
    const rows = data.before_after;
    return rows.map((row, i) => {
      const nextPartial = rows[i + 1]?.partial === true;
      return {
        ...row,
        monthFormatted: formatMonthShort(row.month),
        uncertaintyBand:
          row.uncertainty_lo != null && row.uncertainty_hi != null && row.uncertainty_hi > row.uncertainty_lo
            ? [row.uncertainty_lo, row.uncertainty_hi]
            : null,
        harmonizedFull: row.partial ? null : row.harmonized,
        harmonizedPartial: row.partial || nextPartial ? row.harmonized : null,
      };
    });
  }, [data]);

  const partialRow = data?.before_after?.find((r) => r.partial);
  const partialNote = partialRow ? `${monthLabel(partialRow.month)} = month to date (to 13 Nov)` : null;

  const rows = data?.before_after ?? [];
  const firstMonth = rows[0]?.month;
  const lastMonth = rows[rows.length - 1]?.month;
  const canExport = !loading && !error && chartData.length > 0;

  const exportPng = async () => {
    if (!firstMonth || !lastMonth) throw new Error('No chart data');
    // Off-screen but in the document, so CSS variables still resolve for the inlined styles
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = `position:fixed;left:-${EXPORT_W + 100}px;top:0;width:${EXPORT_W}px;height:${EXPORT_H}px;pointer-events:none;`;
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      flushSync(() => {
        root.render(
          <ProofChart data={chartData} partialNote={partialNote} exportMode width={EXPORT_W} height={EXPORT_H} />
        );
      });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const svg = host.querySelector<SVGSVGElement>('svg.recharts-surface');
      if (!svg) throw new Error('Chart not rendered');
      const canvas = await beforeAfterToCanvas({
        svg,
        areaName: VALIDATION_AREA,
        startLabel: monthLabel(firstMonth),
        endLabel: monthLabel(lastMonth),
        note: partialNote ? `Hollow / dashed point: ${partialNote}. Not a decline: the month is still in progress.` : null,
      });
      await downloadCanvas(canvas, pngFilename('before-after', VALIDATION_AREA_ID, firstMonth, lastMonth));
    } finally {
      root.unmount();
      host.remove();
    }
  };

  return (
    <div
      id="proof"
      className="section"
      style={{ borderBottom: '1px solid var(--color-border)', padding: 'var(--space-2xl) 0' }}
    >
      <div className="section-header">
        <div>
          <h2 style={{ fontSize: '1.45rem', fontWeight: 500 }}>
            Cross-Sensor Calibration Proof
          </h2>
          <span className="section-subtitle">
            Demonstrating how harmonisation eliminates the artificial 2012 sensor cliff without distorting natural interannual variability
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
          {isMock && <SampleDataBadge />}
          <DownloadPngButton
            onExport={exportPng}
            disabled={!canExport}
            ariaLabel="Download before/after harmonization chart as PNG"
          />

          {data && (
            <>
              <div
                style={{
                  padding: '4px 10px',
                  backgroundColor: 'var(--color-bg-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.75rem',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                Holdout Year: <strong style={{ color: 'var(--color-gold)' }}>{data.holdout_year}</strong>
              </div>
              <div
                style={{
                  padding: '4px 10px',
                  backgroundColor: 'var(--color-bg-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.75rem',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                2020 holdout (India): <strong style={{ color: 'var(--color-fire-4)' }}>{data.mape}%</strong> MAPE
              </div>
            </>
          )}
        </div>
      </div>

      <div
        style={{
          backgroundColor: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-lg)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-md)',
          minHeight: '380px',
        }}
      >
        {loading && <LoadingState height="300px" message="Retrieving holdout cross-calibration metrics…" />}

        {error && !loading && (
          error.status === 404 ? (
            <ComingSoonState
              height="300px"
              message="This data isn't available yet."
              subtext="Validation metrics endpoint /validation is being populated."
            />
          ) : (
            <ErrorState
              height="300px"
              message="Couldn't load the before/after chart"
              subtext={error.message}
            />
          )
        )}

        {!loading && !error && chartData.length === 0 && (
          <EmptyState
            height="300px"
            message="No fires in this area to compare"
            subtext="The raw vs harmonized series is empty here. Pick a preset or a bigger area to see the 2012 sensor jump disappear."
          />
        )}

        {!loading && !error && chartData.length > 0 && (
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ProofChart data={chartData} partialNote={partialNote} />
            </ResponsiveContainer>
          </div>
        )}

        {!loading && !error && chartData.length > 0 && partialNote && (
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
            Hollow / dashed point: {partialNote}. Not a decline — the month is still in progress.
          </span>
        )}
      </div>
    </div>
  );
};
