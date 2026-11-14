import React, { useEffect, useState } from 'react';
import { formatCount } from '../../lib/format';

interface CountUpProps {
  value: number;
  durationMs?: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
}

export const CountUp: React.FC<CountUpProps> = ({
  value,
  durationMs = 320,
  decimals = 0,
  suffix = '',
  prefix = '',
}) => {
  const [displayValue, setDisplayValue] = useState<number>(0);

  useEffect(() => {
    // Check reduced motion preference
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplayValue(value);
      return;
    }

    if (isNaN(value)) {
      setDisplayValue(0);
      return;
    }

    let startTimestamp: number | null = null;
    const startValue = 0;
    let animationFrameId: number;

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / durationMs, 1);
      // Ease out quad
      const easeProgress = 1 - (1 - progress) * (1 - progress);
      const current = startValue + (value - startValue) * easeProgress;

      setDisplayValue(current);

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(step);
      } else {
        setDisplayValue(value);
      }
    };

    animationFrameId = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [value, durationMs]);

  return (
    <span>
      {prefix}
      {formatCount(displayValue, decimals)}
      {suffix}
    </span>
  );
};
