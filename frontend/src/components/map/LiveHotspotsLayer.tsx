import React from 'react';
import { useLive } from '../../hooks/useLive';
import { SampleDataBadge } from '../ui/SampleDataBadge';

interface LiveHotspotsControlProps {
  showLive: boolean;
  onToggleLive: (show: boolean) => void;
}

export const LiveHotspotsLayer: React.FC<LiveHotspotsControlProps> = ({
  showLive,
  onToggleLive,
}) => {
  const { data: liveData, isMock, loading, error } = useLive(7);
  const featureCount = liveData?.features?.length ?? 0;
  const is404 = error?.status === 404;

  return (
    <div
      style={{
        padding: '12px',
        backgroundColor: 'var(--color-bg-base)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            id="toggle-live-fires"
            type="checkbox"
            checked={showLive && !is404}
            disabled={is404 || loading}
            onChange={(e) => onToggleLive(e.target.checked)}
            style={{ cursor: is404 ? 'not-allowed' : 'pointer', accentColor: 'var(--color-fire-3)' }}
          />
          <label
            htmlFor="toggle-live-fires"
            style={{
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: is404 ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
              cursor: is404 ? 'not-allowed' : 'pointer',
            }}
          >
            Live VIIRS Hotspots (7-Day)
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {isMock && !is404 && <SampleDataBadge />}
          {is404 ? (
            <span
              style={{
                fontSize: '0.6875rem',
                fontFamily: 'var(--font-mono)',
                color: 'var(--color-gold)',
                backgroundColor: 'rgba(184, 156, 107, 0.1)',
                padding: '2px 6px',
                borderRadius: '3px',
              }}
            >
              Available soon
            </span>
          ) : (
            <span
              className="label-mono"
              style={{
                fontSize: '0.6875rem',
                color: showLive ? 'var(--color-fire-4)' : 'var(--color-muted)',
              }}
            >
              {loading ? 'Fetching…' : `${featureCount} Active`}
            </span>
          )}
        </div>
      </div>

      {is404 ? (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', margin: 0 }}>
          Live fire data isn't available yet on the connected server.
        </p>
      ) : (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', margin: 0 }}>
          Real-time telemetry from NOAA-20 & NOAA-21 instruments (S-NPP retired Nov 2, 2026).
        </p>
      )}

      {showLive && !is404 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '0.6875rem',
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-text-tertiary)',
            paddingTop: '4px',
            borderTop: '1px solid var(--color-border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: 'var(--color-fire-4)',
                display: 'inline-block',
              }}
            />
            NOAA-20
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: 'var(--color-fire-2)',
                display: 'inline-block',
              }}
            />
            NOAA-21
          </div>
          <div style={{ marginLeft: 'auto', color: 'var(--color-gold)' }}>
            High Confidence
          </div>
        </div>
      )}
    </div>
  );
};
