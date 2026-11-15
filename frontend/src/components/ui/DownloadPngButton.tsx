import React, { useState } from 'react';

interface Props {
  /** Builds and downloads the PNG; may throw. */
  onExport: () => Promise<void>;
  /** Accessible name, e.g. "Download burning calendar as PNG". */
  ariaLabel: string;
  disabled?: boolean;
}

/** Small "PNG" download button for chart headers. Native <button>: keyboard reachable. */
export const DownloadPngButton: React.FC<Props> = ({ onExport, ariaLabel, disabled }) => {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await onExport();
    } catch (err) {
      console.warn('[png] export failed', err);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className="png-download-btn"
      onClick={handleClick}
      disabled={disabled || busy}
      aria-label={ariaLabel}
      aria-busy={busy}
      title={failed ? 'Export failed, try again' : ariaLabel}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        fontSize: '0.6875rem',
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.04em',
        padding: '3px 8px',
        color: failed ? 'var(--color-error)' : 'var(--color-gold)',
        backgroundColor: 'rgba(184, 156, 107, 0.08)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        cursor: disabled || busy ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {busy ? 'Saving…' : failed ? 'Retry PNG' : 'Download PNG'}
    </button>
  );
};
