import React from 'react';
import { useSelection } from '../../hooks/useSelection';

export const NavBar: React.FC = () => {
  const { colorScale, setColorScale } = useSelection();

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        backgroundColor: 'rgba(16, 18, 32, 0.96)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid var(--color-border)',
        height: '64px',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          maxWidth: '1360px',
          width: '100%',
          margin: '0 auto',
          padding: '0 var(--space-lg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-md)',
        }}
      >
        {/* Brand matching Image 2: Circular Space Shuttle Logo + Prometheus 375 */}
        <a
          href="#top"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            textDecoration: 'none',
            color: 'var(--color-text-primary)',
            flexShrink: 0,
          }}
          aria-label="Prometheus 375 Home"
        >
          {/* Circular logo mark with subtle gold ring & shuttle inside */}
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              overflow: 'hidden',
              border: '1px solid rgba(184, 156, 107, 0.5)',
              boxShadow: '0 0 12px rgba(184, 156, 107, 0.25)',
              backgroundColor: '#0a0d18',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <img
              src="/logo.png?v=2"
              alt="Prometheus 375 Logo"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          </div>

          {/* Clean Brand Typography: Prometheus 375 */}
          <span
            style={{
              fontFamily: 'var(--font-serif)',
              fontWeight: 600,
              fontSize: '1.25rem',
              letterSpacing: '0.01em',
              color: 'var(--color-text-primary)',
              lineHeight: 1,
            }}
          >
            Prometheus <span style={{ color: 'var(--color-gold)' }}>375</span>
          </span>
        </a>

        {/* Center Nav Links matching Image 2 */}
        <nav
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-lg)',
          }}
          aria-label="Section Navigation"
        >
          <a
            href="#explore"
            className="nav-link"
            style={{
              fontSize: '0.875rem',
              color: 'var(--color-text-secondary)',
              textDecoration: 'none',
              fontWeight: 500,
            }}
          >
            Explore
          </a>
          <a
            href="#calendar"
            className="nav-link"
            style={{
              fontSize: '0.875rem',
              color: 'var(--color-text-secondary)',
              textDecoration: 'none',
              fontWeight: 500,
            }}
          >
            Fire calendar
          </a>
          <a
            href="#method"
            className="nav-link"
            style={{
              fontSize: '0.875rem',
              color: 'var(--color-text-secondary)',
              textDecoration: 'none',
              fontWeight: 500,
            }}
          >
            Method
          </a>
          <a
            href="#datasets"
            className="nav-link"
            style={{
              fontSize: '0.875rem',
              color: 'var(--color-text-secondary)',
              textDecoration: 'none',
              fontWeight: 500,
            }}
          >
            Data
          </a>
        </nav>

        {/* Right Controls: Color Ramp & Download Data button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          {/* Color Ramp Selector */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: 'var(--color-bg-base)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px',
            }}
          >
            <button
              type="button"
              onClick={() => setColorScale('fire')}
              aria-label="Select Fire Palette"
              style={{
                padding: '4px 8px',
                fontSize: '0.75rem',
                fontFamily: 'var(--font-mono)',
                backgroundColor: colorScale === 'fire' ? 'var(--color-fire-3)' : 'transparent',
                color: colorScale === 'fire' ? '#ffffff' : 'var(--color-text-tertiary)',
                borderRadius: '3px',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Fire
            </button>
            <button
              type="button"
              onClick={() => setColorScale('viridis')}
              aria-label="Select Viridis Palette"
              style={{
                padding: '4px 8px',
                fontSize: '0.75rem',
                fontFamily: 'var(--font-mono)',
                backgroundColor: colorScale === 'viridis' ? 'var(--color-viridis-3)' : 'transparent',
                color: colorScale === 'viridis' ? '#ffffff' : 'var(--color-text-tertiary)',
                borderRadius: '3px',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Viridis
            </button>
          </div>

          {/* Download Data Action Button matching Image 2 */}
          <a
            href="#datasets"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '8px 16px',
              backgroundColor: 'transparent',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8125rem',
              fontWeight: 500,
              fontFamily: 'var(--font-sans)',
              textDecoration: 'none',
              transition: 'border-color 180ms ease-out, color 180ms ease-out, background-color 180ms ease-out',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-gold)';
              e.currentTarget.style.color = 'var(--color-gold)';
              e.currentTarget.style.backgroundColor = 'rgba(184, 156, 107, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-border)';
              e.currentTarget.style.color = 'var(--color-text-primary)';
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            Download data
          </a>
        </div>
      </div>
    </header>
  );
};
