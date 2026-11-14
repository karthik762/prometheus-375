import React from 'react';
import { useAnomaly } from '../../hooks/useAnomaly';
import { useSelection } from '../../hooks/useSelection';
import { CountUp } from './CountUp';
import { formatCount, formatMonthShort } from '../../lib/format';
import { LoadingState, ComingSoonState, ErrorState } from '../ui/States';
import { SampleDataBadge } from '../ui/SampleDataBadge';

export const NowVsNormalCard: React.FC = () => {
  const { data: anomaly, isMock, loading, error, refetch } = useAnomaly();
  const { selectedMonth } = useSelection();

  const monthLabel = formatMonthShort(selectedMonth).toUpperCase();

  return (
    <div
      style={{
        backgroundColor: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-lg)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: '440px',
      }}
    >
      <div>
        {/* Top Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid var(--color-border-subtle)',
            paddingBottom: '8px',
            marginBottom: 'var(--space-lg)',
          }}
        >
          <span
            className="label-mono"
            style={{
              color: 'var(--color-gold)',
              fontSize: '0.6875rem',
              letterSpacing: '0.08em',
            }}
          >
            NOW VS NORMAL • {monthLabel}
          </span>
          {isMock && <SampleDataBadge />}
        </div>

        {loading && <LoadingState height="240px" message="Evaluating climatological normal…" />}

        {error && !loading && (
          error.status === 404 ? (
            <ComingSoonState
              height="240px"
              message="This data isn't available yet."
              subtext="The /anomaly baseline calculation is in development on the server."
            />
          ) : (
            <ErrorState
              height="240px"
              message="Anomaly metrics unavailable"
              subtext={error.message}
              onRetry={refetch}
            />
          )
        )}

        {!loading && !error && anomaly && (
          <div>
            {/* Giant Stat Display */}
            <div
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 'clamp(2.8rem, 4.5vw, 3.8rem)',
                color: 'var(--color-text-primary)',
                fontWeight: 500,
                lineHeight: 1.05,
                marginBottom: 'var(--space-md)',
                letterSpacing: '-0.02em',
              }}
            >
              <CountUp value={anomaly.current} />
            </div>

            {/* Context sentences */}
            <p
              style={{
                fontSize: '0.9375rem',
                color: 'var(--color-text-secondary)',
                lineHeight: 1.5,
                marginBottom: 'var(--space-sm)',
              }}
            >
              Fires this month, against a typical November of{' '}
              <strong style={{ color: 'var(--color-text-primary)' }}>
                {formatCount(anomaly.median)}
              </strong>
              .
            </p>

            <div
              style={{
                fontSize: '0.9375rem',
                color: 'var(--color-text-primary)',
                fontWeight: 600,
                marginTop: '4px',
              }}
            >
              Season started{' '}
              <span style={{ color: 'var(--color-gold)' }}>
                {Math.abs(anomaly.onset_shift_days).toFixed(0)} days{' '}
                {anomaly.onset_shift_days <= 0 ? 'early' : 'late'}
              </span>
              .
            </div>

            {/* Percentile and Z-Score */}
            <div
              style={{
                marginTop: 'var(--space-md)',
                paddingTop: 'var(--space-md)',
                borderTop: '1px solid var(--color-border-subtle)',
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.75rem',
                fontFamily: 'var(--font-mono)',
                color: 'var(--color-text-tertiary)',
              }}
            >
              <span>Historical Rank: {anomaly.percentile.toFixed(1)}th</span>
              <span>Z-Score: {anomaly.z_score >= 0 ? `+${anomaly.z_score.toFixed(2)}` : anomaly.z_score.toFixed(2)}σ</span>
            </div>
          </div>
        )}
      </div>

      {/* Footnote */}
      <div
        style={{
          paddingTop: 'var(--space-md)',
          borderTop: '1px solid var(--color-border-subtle)',
          fontSize: '0.6875rem',
          color: 'var(--color-text-tertiary)',
          lineHeight: 1.4,
        }}
      >
        Day-matched baseline from 2000–2025. Per-satellite normalization guarantees cross-sensor fidelity.
      </div>
    </div>
  );
};
