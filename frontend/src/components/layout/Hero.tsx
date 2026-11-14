import React from 'react';

export const Hero: React.FC = () => {
  return (
    <section
      id="top"
      style={{
        padding: 'var(--space-3xl) 0 var(--space-2xl) 0',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.2fr 0.8fr',
          gap: 'var(--space-2xl)',
          alignItems: 'center',
        }}
      >
        {/* Left Column: Mission & Headline */}
        <div>
          <div
            className="reveal-label"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-sm)',
              marginBottom: 'var(--space-md)',
            }}
          >
            <span
              className="label-mono"
              style={{
                color: 'var(--color-gold)',
                letterSpacing: '0.08em',
                fontSize: '0.6875rem',
              }}
            >
              NASA SPACE APPS 2026 • VIIRS 375 m • MODIS 1 km
            </span>
          </div>

          <h1
            className="reveal-title"
            style={{
              fontSize: 'clamp(2.4rem, 4.2vw, 3.6rem)',
              fontWeight: 500,
              lineHeight: 1.12,
              marginBottom: 'var(--space-md)',
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.02em',
            }}
          >
            One fire record, from 2001 to today.
          </h1>

          <p
            className="reveal-body"
            style={{
              fontSize: '1.0625rem',
              lineHeight: 1.65,
              color: 'var(--color-text-secondary)',
              marginBottom: 'var(--space-xl)',
              maxWidth: '560px',
            }}
          >
            Two generations of satellites, put on the same scale. Pick an area, see how this season compares with its normal, and take the data with you.
          </p>

          <div style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'center' }}>
            <a
              href="#explore"
              className="btn btn-terracotta"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '12px 24px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.9375rem',
                fontWeight: 600,
                textDecoration: 'none',
                lineHeight: 1.2,
              }}
            >
              Explore an area
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </a>

            <span
              className="label-mono"
              style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}
            >
              0.25° Equal-Area Grid • S-NPP Retired Nov 2, 2026
            </span>
          </div>
        </div>

        {/* Right Column: Glowing Black Marble Earth Globe */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: '380px',
              aspectRatio: '1 / 1',
              borderRadius: '50%',
              overflow: 'hidden',
              boxShadow: '0 0 50px rgba(184, 156, 107, 0.12), inset 0 0 40px rgba(10, 13, 24, 0.9)',
              border: '1px solid rgba(184, 156, 107, 0.2)',
            }}
          >
            <img
              src="/images/earth_night.jpg"
              alt="NASA Black Marble Nighttime Lights"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: 'scale(1.05)',
                filter: 'brightness(1.05) contrast(1.1)',
                transition: 'transform 600ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1.05)';
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
};
