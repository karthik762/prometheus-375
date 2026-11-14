import React, { useEffect, useRef, useState, type ReactNode } from 'react';

interface RevealProps {
  children: ReactNode;
  className?: string;
  delayMs?: number;
}

export const Reveal: React.FC<RevealProps> = ({ children, className = '', delayMs = 0 }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setIsVisible(true);
      return;
    }

    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            if (delayMs > 0) {
              setTimeout(() => setIsVisible(true), delayMs);
            } else {
              setIsVisible(true);
            }
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08 }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [delayMs]);

  return (
    <div
      ref={ref}
      className={`reveal ${isVisible ? 'is-visible' : ''} ${className}`}
    >
      {children}
    </div>
  );
};
