import React from 'react';

interface SampleDataBadgeProps {
  className?: string;
  style?: React.CSSProperties;
}

export const SampleDataBadge: React.FC<SampleDataBadgeProps> = ({ className = '', style }) => {
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 6px',
        fontSize: '11px',
        fontFamily: 'var(--font-mono)',
        color: '#B89C6B',
        backgroundColor: 'rgba(184, 156, 107, 0.08)',
        border: '1px solid #B89C6B',
        borderRadius: '4px',
        lineHeight: 1.2,
        letterSpacing: '0.04em',
        userSelect: 'none',
        ...style,
      }}
      title="Sample data (offline mock baseline)"
    >
      Sample data
    </span>
  );
};
