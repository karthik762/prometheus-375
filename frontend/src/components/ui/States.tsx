import React from 'react';
import { Button } from './Button';

interface StateProps {
  height?: number | string;
  message?: string;
  subtext?: string;
  onRetry?: () => void;
}

export const LoadingState: React.FC<StateProps> = ({
  height = '320px',
  message = 'Harmonizing satellite data…',
}) => {
  return (
    <div
      style={{
        height,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(22, 26, 55, 0.4)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-lg)',
        gap: 'var(--space-md)',
      }}
      role="status"
      aria-live="polite"
    >
      <div
        style={{
          width: '28px',
          height: '28px',
          border: '2px solid var(--color-border)',
          borderTopColor: 'var(--color-gold)',
          borderRadius: '50%',
          animation: 'spin 800ms linear infinite',
        }}
      />
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div style={{ textAlign: 'center' }}>
        <p style={{ color: 'var(--color-text-primary)', fontWeight: 500, fontSize: '0.875rem' }}>
          {message}
        </p>
        <span className="label-mono" style={{ fontSize: '0.7rem' }}>
          Querying 0.25° grid & cross-calibrating sensors
        </span>
      </div>
    </div>
  );
};

export const EmptyState: React.FC<StateProps> = ({
  height = '240px',
  message = 'No fire data for this area yet',
  subtext = 'Try selecting a larger bounding area or expanding the date range.',
}) => {
  return (
    <div
      style={{
        height,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(22, 26, 55, 0.2)',
        border: '1px dashed var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-lg)',
        textAlign: 'center',
        gap: 'var(--space-sm)',
      }}
    >
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-muted)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </svg>
      <p style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{message}</p>
      {subtext && <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)', maxWidth: '360px' }}>{subtext}</p>}
    </div>
  );
};

export const ComingSoonState: React.FC<StateProps> = ({
  height = '240px',
  message = "This data isn't available yet.",
  subtext = 'The backend endpoint is currently in active development.',
}) => {
  return (
    <div
      style={{
        height,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(22, 26, 55, 0.3)',
        border: '1px dashed rgba(184, 156, 107, 0.4)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-lg)',
        textAlign: 'center',
        gap: 'var(--space-sm)',
      }}
    >
      <div
        style={{
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          border: '1px solid var(--color-gold)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-gold)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.8125rem',
        }}
      >
        404
      </div>
      <p style={{ color: 'var(--color-text-primary)', fontWeight: 500, margin: 0 }}>
        {message}
      </p>
      {subtext && (
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)', maxWidth: '340px', margin: 0 }}>
          {subtext}
        </p>
      )}
      <span
        style={{
          fontSize: '0.6875rem',
          fontFamily: 'var(--font-mono)',
          color: 'var(--color-gold)',
          backgroundColor: 'rgba(184, 156, 107, 0.1)',
          padding: '2px 8px',
          borderRadius: '3px',
          marginTop: '4px',
        }}
      >
        Available soon
      </span>
    </div>
  );
};

export const ErrorState: React.FC<StateProps> = ({
  height = '240px',
  message = 'Unable to load dataset',
  subtext = 'A connection error occurred while querying the harmonized service.',
  onRetry,
}) => {
  return (
    <div
      style={{
        height,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(224, 93, 93, 0.05)',
        border: '1px solid rgba(224, 93, 93, 0.3)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-lg)',
        textAlign: 'center',
        gap: 'var(--space-sm)',
      }}
      role="alert"
    >
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-error)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <p style={{ color: 'var(--color-error)', fontWeight: 500 }}>{message}</p>
      {subtext && (
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)', maxWidth: '380px' }}>
          {subtext}
        </p>
      )}
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry} style={{ marginTop: 'var(--space-xs)' }}>
          Retry Request
        </Button>
      )}
    </div>
  );
};
