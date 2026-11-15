import React from 'react';
import { SelectionProvider } from './hooks/useSelection';
import { NavBar } from './components/layout/NavBar';
import { Hero } from './components/layout/Hero';
import StoryHero from './components/StoryHero';
import { Footer } from './components/layout/Footer';
import { FireMap } from './components/map/FireMap';
import { BurnCalendar } from './components/calendar/BurnCalendar';
import { NowVsNormalCard } from './components/stats/NowVsNormalCard';
import { TimeSlider } from './components/stats/TimeSlider';
import { BeforeAfterChart } from './components/charts/BeforeAfterChart';
import { DatasetCoverSection } from './components/data/DatasetCover';
import { Reveal } from './components/ui/Reveal';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

// Scroll-story hero is the default; set VITE_USE_STORY_HERO=false to fall back to the original Hero.
const USE_STORY_HERO = import.meta.env.VITE_USE_STORY_HERO !== 'false';

// Height of the sticky NavBar (its header is 64px). StoryHero offsets its sticky stage by this.
const appVars = { '--nav-height': '64px' } as React.CSSProperties;

export const AppContent: React.FC = () => {
  return (
    <div className="app-container" style={appVars}>
      {/* 1. Sticky Navigation Bar with Cropped Shuttle Logo */}
      <NavBar />

      <main className="main-content">
        {/* 2. Hero Mission & Black Marble Nighttime Lights Globe */}
        {USE_STORY_HERO ? <StoryHero /> : <Hero />}

        {/* 3. Explore: Preset Selection + Interactive Geographic Map */}
        <Reveal>
          <ErrorBoundary
            height="480px"
            message="The map couldn't start"
            subtext="This browser has WebGL turned off or unavailable. The calendar and charts below still work."
          >
            <FireMap />
          </ErrorBoundary>
        </Reveal>

        {/* 4. Timeline Slider Scrubber */}
        <div style={{ margin: 'var(--space-lg) 0' }}>
          <TimeSlider />
        </div>

        {/* 5. Magazine Core Row: Burn Calendar (2/3) + Now-vs-Normal Card (1/3) */}
        <section id="calendar" className="section" style={{ padding: 'var(--space-2xl) 0' }}>
          <div className="magazine-row">
            <BurnCalendar />
            <NowVsNormalCard />
          </div>
        </section>

        {/* 6. Field Notes Hero Band with Forest Fire Visual matching Image 2 & 3 */}
        <Reveal>
          <div
            style={{
              position: 'relative',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              margin: 'var(--space-2xl) 0',
              minHeight: '260px',
              border: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {/* Background Image: Forest Fire Ground Line */}
            <img
              src="/images/forest_fire.jpg"
              alt="A line of low flames creeping through a pine forest floor at night, with smoke drifting between the trees"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: 'brightness(0.65) contrast(1.15)',
              }}
            />

            {/* Deep Navy/Black Gradient Overlay to guarantee text contrast >= 4.5:1 */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                background: 'linear-gradient(90deg, rgba(16, 18, 32, 0.94) 0%, rgba(16, 18, 32, 0.8) 45%, rgba(16, 18, 32, 0.3) 100%)',
              }}
            />

            {/* Content matching Image 2 */}
            <div
              style={{
                position: 'relative',
                zIndex: 2,
                padding: 'var(--space-2xl)',
                maxWidth: '680px',
              }}
            >
              <div
                className="label-mono"
                style={{
                  color: 'var(--color-gold)',
                  letterSpacing: '0.08em',
                  fontSize: '0.6875rem',
                  marginBottom: '8px',
                }}
              >
                FIELD NOTES
              </div>

              <h2
                style={{
                  fontSize: 'clamp(1.8rem, 3vw, 2.5rem)',
                  fontWeight: 500,
                  lineHeight: 1.15,
                  color: '#ffffff',
                  marginBottom: '12px',
                  letterSpacing: '-0.01em',
                }}
              >
                Sensors change. The fire record shouldn't.
              </h2>

              <p
                style={{
                  fontSize: '0.9375rem',
                  color: 'var(--color-text-primary)',
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                Across 26 years, NASA’s earth observation orbiters have continually evolved. By isolating instrument resolution improvements from true land-surface dynamics, Prometheus 375 gives climate researchers, agricultural monitors, and emergency responders one unbroken baseline.
              </p>
            </div>
          </div>
        </Reveal>

        {/* 7. Methodology 3 Notes matching Image 2 */}
        <Reveal>
          <section id="method" className="section" style={{ padding: 'var(--space-2xl) 0' }}>
            <div className="cards-grid-3">
              {/* Note 01 */}
              <div
                className="editorial-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  backgroundColor: 'var(--color-bg-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-lg)',
                }}
              >
                <span className="label-mono" style={{ color: 'var(--color-gold)', fontSize: '0.75rem' }}>
                  01
                </span>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 500, margin: 0, color: 'var(--color-text-primary)' }}>
                  Why the 2012 jump is fake
                </h3>
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.6, margin: 0 }}>
                  VIIRS sees 375 m pixels, MODIS about 1 km. Raw counts leap when VIIRS arrives; ours don't.
                </p>
              </div>

              {/* Note 02 */}
              <div
                className="editorial-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  backgroundColor: 'var(--color-bg-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-lg)',
                }}
              >
                <span className="label-mono" style={{ color: 'var(--color-gold)', fontSize: '0.75rem' }}>
                  02
                </span>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 500, margin: 0, color: 'var(--color-text-primary)' }}>
                  How we harmonise
                </h3>
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.6, margin: 0 }}>
                  Per-satellite averages on a 0.25° grid, then a MODIS-to-VIIRS fit for each region and month.
                </p>
              </div>

              {/* Note 03 */}
              <div
                className="editorial-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  backgroundColor: 'var(--color-bg-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-lg)',
                }}
              >
                <span className="label-mono" style={{ color: 'var(--color-gold)', fontSize: '0.75rem' }}>
                  03
                </span>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 500, margin: 0, color: 'var(--color-text-primary)' }}>
                  Checked against a held-out year
                </h3>
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.6, margin: 0 }}>
                  We hide 2020, predict it, and report the error: 11.4% error per month across India (vs 24.8% with a single ratio).
                </p>
              </div>
            </div>
          </section>
        </Reveal>

        {/* 8. Cross-Sensor Calibration Proof (Recharts line chart) */}
        <Reveal>
          <BeforeAfterChart />
        </Reveal>

        {/* 9. Datasets: 3 Emberglass cover cards with copper shimmer */}
        <Reveal>
          <DatasetCoverSection />
        </Reveal>
      </main>

      {/* 10. Footer */}
      <Footer />
    </div>
  );
};

export default function App() {
  return (
    <SelectionProvider>
      <AppContent />
    </SelectionProvider>
  );
}
