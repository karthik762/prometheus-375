import React, { type ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  className = '',
  disabled,
  style,
  ...props
}) => {
  const getStyles = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      borderRadius: 'var(--radius-sm)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.6 : 1,
      transition: 'background-color var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast)',
      width: fullWidth ? '100%' : 'auto',
      textDecoration: 'none',
      whiteSpace: 'nowrap',
      lineHeight: 1.2,
      ...style,
    };

    const sizeStyles = {
      sm: { padding: '6px 10px', fontSize: '0.8125rem' },
      md: { padding: '8px 14px', fontSize: '0.875rem' },
      lg: { padding: '12px 20px', fontSize: '1rem' },
    }[size];

    const variantStyles = {
      primary: {
        backgroundColor: 'var(--color-gold)',
        color: '#10121d',
        border: '1px solid var(--color-gold)',
        fontWeight: 600,
      },
      secondary: {
        backgroundColor: 'var(--color-bg-surface)',
        color: 'var(--color-text-primary)',
        border: '1px solid var(--color-border)',
      },
      ghost: {
        backgroundColor: 'transparent',
        color: 'var(--color-text-secondary)',
        border: '1px solid transparent',
      },
      danger: {
        backgroundColor: 'transparent',
        color: 'var(--color-error)',
        border: '1px solid rgba(224, 93, 93, 0.4)',
      },
    }[variant];

    return { ...base, ...sizeStyles, ...variantStyles };
  };

  return (
    <button
      disabled={disabled}
      style={getStyles()}
      className={`btn btn-${variant} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
