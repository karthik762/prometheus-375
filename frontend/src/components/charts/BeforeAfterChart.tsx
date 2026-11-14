import React from 'react';
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
import { LoadingState, ComingSoonState, ErrorState } from '../ui/States';
import { SampleDataBadge } from '../ui/SampleDataBadge';

export const BeforeAfterChart: React.FC = () => {
  const { data, isMock, loading, error } = useValidation();

  // Prepare data with uncertainty bounds formatted for Area chart
  const chartData = React.useMemo(() => {
    if (!data?.before_after) return [];
    return data.before_after.map((row) => ({
      ...row,
      monthFormatted: formatMonthShort(row.month),
      uncertaintyBand: [row.uncertainty_lo ?? row.harmonized * 0.9, row.uncertainty_hi ?? row.harmonized * 1.1],
    }));
  }, [data]);

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

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          {isMock && <SampleDataBadge />}

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
                MAPE: <strong style={{ color: 'var(--color-fire-4)' }}>{data.mape.toFixed(1)}%</strong>
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
              message="Unable to load validation series"
              subtext={error.message}
            />
          )
        )}

        {!loading && !error && chartData.length > 0 && (
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
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
                <Tooltip
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
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend
                  verticalAlign="top"
                  height={32}
                  formatter={(val) => (
                    <span style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>{val}</span>
                  )}
                />

                {/* Uncertainty 90% confidence envelope */}
                <Area
                  type="monotone"
                  dataKey="uncertaintyBand"
                  name="Harmonized 90% CI"
                  fill="rgba(184, 156, 107, 0.12)"
                  stroke="none"
                  isAnimationActive={true}
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
                  dot={{ r: 2.5, fill: '#5f677a' }}
                  isAnimationActive={true}
                  animationDuration={500}
                  animationEasing="ease-out"
                />

                {/* Harmonized series (continuous) */}
                <Line
                  type="monotone"
                  dataKey="harmonized"
                  name="Prometheus 375 Harmonized"
                  stroke="var(--color-gold)"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: 'var(--color-gold)' }}
                  isAnimationActive={true}
                  animationDuration={500}
                  animationEasing="ease-out"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};
