import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer
      style={{
        backgroundColor: '#10121e',
        borderTop: '1px solid var(--color-border)',
        padding: 'var(--space-2xl) 0 var(--space-xl) 0',
        marginTop: 'var(--space-3xl)',
      }}
    >
      <div
        style={{
          maxWidth: '1360px',
          margin: '0 auto',
          padding: '0 var(--space-lg)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 'var(--space-xl)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--space-sm)' }}>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: '1.1rem', fontWeight: 600 }}>
              Prometheus <span style={{ color: 'var(--color-gold)' }}>375</span>
            </span>
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
            Harmonized burning activity calendar unifying NASA MODIS (1 km) and VIIRS (375 m) active fire detections. Developed for NASA Space Apps Challenge 2026, Hyderabad.
          </p>
        </div>

        <div>
          <div className="label-mono" style={{ marginBottom: 'var(--space-sm)', color: 'var(--color-text-secondary)' }}>
            Data Governance & FIRMS Feeds
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
            All active-fire hotspots sourced from{' '}
            <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noopener noreferrer">
              NASA FIRMS (EOSDIS)
            </a>
            . Filtering criteria: vegetation fires only (<code>type == 0</code>), dropping low-confidence detections. Note: S-NPP retired on November 2, 2026; near-real-time observations are sourced from NOAA-20 and NOAA-21.
          </p>
        </div>

        <div>
          <div className="label-mono" style={{ marginBottom: 'var(--space-sm)', color: 'var(--color-text-secondary)' }}>
            Calibration Architecture
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
            0.25° spatial grid cells aggregated into monthly per-satellite averages. Historical MODIS series (2000–2011) are scaled using regional cross-sensor transfer ratios with empirical 90% uncertainty intervals.
          </p>
        </div>
      </div>

      <div
        style={{
          maxWidth: '1360px',
          margin: 'var(--space-xl) auto 0 auto',
          padding: 'var(--space-md) var(--space-lg) 0 var(--space-lg)',
          borderTop: '1px solid var(--color-border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--space-sm)',
        }}
      >
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
          © 2026 Team Prometheus 375. Open source under MIT License.
        </span>
        <span className="label-mono" style={{ fontSize: '0.7rem' }}>
          Terra • Aqua • S-NPP (2012–2026) • NOAA-20 • NOAA-21
        </span>
      </div>
    </footer>
  );
};
