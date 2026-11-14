import React from 'react';
import { useSelection } from '../../hooks/useSelection';
import { getRampLegendSteps } from '../../lib/colorRamp';

export const CalendarLegend: React.FC = () => {
  const { colorScale } = useSelection();
  const steps = getRampLegendSteps(colorScale);

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-md)',
        paddingTop: 'var(--space-sm)',
        borderTop: '1px solid var(--color-border-subtle)',
        fontSize: '0.75rem',
      }}
    >
      {/* Sensor Texture Encoding */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div
            className="hatched-cell"
            style={{
              width: '16px',
              height: '16px',
              border: '1px solid var(--color-border)',
              borderRadius: '2px',
              backgroundColor: 'var(--color-fire-3)',
            }}
          />
          <span style={{ color: 'var(--color-text-secondary)' }}>
            Hatched: Estimated from MODIS (2001–2011) ± uncertainty
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div
            style={{
              width: '16px',
              height: '16px',
              border: '1px solid var(--color-border)',
              borderRadius: '2px',
              backgroundColor: 'var(--color-fire-3)',
            }}
          />
          <span style={{ color: 'var(--color-text-secondary)' }}>
            Solid: VIIRS Native 375m (2012–2026)
          </span>
        </div>
      </div>

      {/* Color Ramp Gradient Steps */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span className="label-mono" style={{ fontSize: '0.6875rem', marginRight: '4px' }}>
          Hotspot Intensity:
        </span>
        {steps.map((s, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <span
              style={{
                width: '12px',
                height: '12px',
                backgroundColor: s.color,
                borderRadius: '2px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                display: 'inline-block',
              }}
            />
            <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-tertiary)', marginRight: '6px' }}>
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
