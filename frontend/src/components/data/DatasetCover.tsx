import React, { useEffect, useRef, useState } from 'react';
import { useSelection } from '../../hooks/useSelection';
import { useValidation } from '../../hooks/useValidation';
import { getExportHotspotsCsvUrl, getExportAnalyticsCsvUrl, isOfflineMockMode } from '../../api/api';
import { SampleDataBadge } from '../ui/SampleDataBadge';
import mockValidation from '../../api/mock/validation.json';
import { areaDeg2, MAX_AREA_DEG2 } from '../../lib/area';

interface DatasetCoverProps {
  title: string;
  category: string;
  format: string;
  description: string;
  downloadUrl: string;
  filename: string;
  fields: string[];
  sampleCurl: string;
  downloadLabel: string;
  isMock: boolean;
  isDisabled?: boolean;
  /** Short badge/button text when disabled (default "Available soon") */
  disabledLabel?: string;
  /** One line under the card when disabled (default "Endpoint not published yet") */
  disabledNote?: string;
  /** Shown for a while after clicking download, e.g. while the server builds a big CSV */
  preparingNote?: string;
}

export const DatasetCoverCard: React.FC<DatasetCoverProps> = ({
  title,
  category,
  format,
  description,
  downloadUrl,
  filename,
  fields,
  sampleCurl,
  downloadLabel,
  isMock,
  isDisabled = false,
  disabledLabel = 'Available soon',
  disabledNote = 'Endpoint not published yet',
  preparingNote,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [preparing, setPreparing] = useState<boolean>(false);
  const prepTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(prepTimer.current), []);

  const handleClick = () => {
    if (isDisabled) return;
    setIsExpanded(!isExpanded);
  };

  return (
    <div
      className={isDisabled ? 'editorial-card' : 'cover editorial-card'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: 'var(--color-bg-surface)',
        border: isDisabled ? '1px dashed var(--color-border)' : '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-lg)',
        minHeight: '280px',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.75 : 1,
        position: 'relative',
        overflow: 'hidden',
      }}
      onClick={handleClick}
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      aria-disabled={isDisabled}
      aria-expanded={isExpanded}
      onKeyDown={(e) => {
        if (!isDisabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          setIsExpanded(!isExpanded);
        }
      }}
    >
      {/* Topographic illustration background (only on active cards) */}
      {!isDisabled && (
        <img
          src="/images/world_map.jpg"
          alt=""
          aria-hidden="true"
          className="cover-topo"
        />
      )}

      <div style={{ position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span className="label-mono" style={{ color: 'var(--color-gold)', fontSize: '0.6875rem' }}>
            {category}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {isMock && !isDisabled && <SampleDataBadge />}
            {isDisabled ? (
              <span
                style={{
                  padding: '2px 6px',
                  backgroundColor: 'rgba(184, 156, 107, 0.1)',
                  border: '1px solid var(--color-gold)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.6875rem',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-gold)',
                }}
              >
                {disabledLabel}
              </span>
            ) : (
              <span
                style={{
                  padding: '2px 6px',
                  backgroundColor: 'var(--color-bg-base)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.6875rem',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {format}
              </span>
            )}
          </div>
        </div>

        <h3 style={{ fontSize: '1.2rem', fontWeight: 500, marginBottom: '8px', color: 'var(--color-text-primary)' }}>
          {title}
        </h3>

        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: 'var(--space-md)' }}>
          {description}
        </p>

        {/* Fields preview */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {fields.map((f) => (
            <code
              key={f}
              style={{
                backgroundColor: 'rgba(20, 22, 37, 0.8)',
                border: '1px solid var(--color-border-subtle)',
                padding: '2px 6px',
                borderRadius: '3px',
                fontSize: '0.6875rem',
                color: 'var(--color-text-tertiary)',
              }}
            >
              {f}
            </code>
          ))}
        </div>

        {/* Expandable Drawer */}
        {!isDisabled && (
          <div className={`dataset-drawer ${isExpanded ? 'is-expanded' : ''}`}>
            <div
              style={{
                padding: '10px',
                backgroundColor: 'var(--color-bg-base)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.75rem',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="label-mono" style={{ fontSize: '0.625rem', display: 'block', marginBottom: '4px' }}>
                REST API Endpoint Query
              </span>
              <pre
                style={{
                  margin: 0,
                  color: 'var(--color-gold)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.6875rem',
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {sampleCurl}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Download Action Link */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          paddingTop: 'var(--space-md)',
          borderTop: '1px solid var(--color-border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 'var(--space-md)',
        }}
      >
        <span style={{ fontSize: '0.75rem', color: isDisabled ? 'var(--color-muted)' : 'var(--color-gold)' }}>
          {isDisabled
            ? disabledNote
            : preparing && preparingNote
            ? preparingNote
            : isExpanded
            ? 'Click to collapse details'
            : 'Click to inspect endpoint'}
        </span>

        {isDisabled ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '6px 12px',
              backgroundColor: 'transparent',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-muted)',
              fontSize: '0.75rem',
              fontFamily: 'var(--font-sans)',
            }}
          >
            {disabledLabel}
          </span>
        ) : (
          <a
            href={downloadUrl}
            download={filename}
            onClick={(e) => {
              e.stopPropagation();
              if (!preparingNote) return;
              // The browser shows nothing until the server has built the whole file
              setPreparing(true);
              window.clearTimeout(prepTimer.current);
              prepTimer.current = window.setTimeout(() => setPreparing(false), 25000);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              backgroundColor: 'var(--color-bg-base)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-primary)',
              fontSize: '0.75rem',
              fontFamily: 'var(--font-sans)',
              textDecoration: 'none',
              fontWeight: 500,
              transition: 'border-color 180ms ease-out, color 180ms ease-out',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-gold)';
              e.currentTarget.style.color = 'var(--color-gold)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-border)';
              e.currentTarget.style.color = 'var(--color-text-primary)';
            }}
          >
            {downloadLabel}
          </a>
        )}
      </div>
    </div>
  );
};

export const DatasetCoverSection: React.FC = () => {
  const { area, startMonth, endMonth } = useSelection();
  const { error: validationError, isMock: valIsMock } = useValidation();

  const hotspotsExport = getExportHotspotsCsvUrl(area, startMonth, endMonth);
  const analyticsExport = getExportAnalyticsCsvUrl(area, startMonth, endMonth);

  const isMockMode = isOfflineMockMode();
  const isVal404 = validationError?.status === 404;
  // status 0 = unreachable / waking up, 5xx = server error; a dead link would leave the site
  const backendDown = !isMockMode && !!validationError && (validationError.status === 0 || (validationError.status ?? 0) >= 500);
  // Drawn areas are already capped at draw time; this also covers future presets/bboxes
  const tooBigForHotspots = !isMockMode && areaDeg2(area) > MAX_AREA_DEG2;
  const downNote = 'Data server unreachable. Reload the page in a moment to retry.';

  return (
    <div id="datasets" className="section" style={{ borderBottom: 'none', padding: 'var(--space-3xl) 0' }}>
      <div className="section-header">
        <div>
          <h2 style={{ fontSize: '1.45rem', fontWeight: 500 }}>
            Datasets
          </h2>
          <span className="section-subtitle">
            Emberglass reproducible export suites filtered to your current spatial boundary
          </span>
        </div>
      </div>

      <div className="cards-grid-3">
        <DatasetCoverCard
          title="Every hotspot in your search"
          category="CSV • HOTSPOTS"
          format="CSV"
          filename={`prometheus375_hotspots_${area.presetId || 'custom'}.csv`}
          downloadUrl={hotspotsExport.url}
          downloadLabel={hotspotsExport.isMock ? 'Sample CSV' : 'Download CSV'}
          isMock={hotspotsExport.isMock}
          isDisabled={backendDown || tooBigForHotspots}
          disabledLabel={backendDown ? 'Offline' : 'Area too large'}
          disabledNote={
            backendDown
              ? downNote
              : 'Cell-level CSV is limited to areas up to about twice California. Draw a smaller area, or use the monthly CSV.'
          }
          preparingNote="Preparing your CSV… this can take up to ~20 s before the download starts."
          description="Cell-level monthly active fire counts cross-calibrated between MODIS and VIIRS with empirical uncertainty intervals."
          fields={['cell_id', 'lat', 'lon', 'month', 'harmonized_count', 'source', 'uncertainty']}
          sampleCurl={`curl "${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/export.csv?start=${startMonth}&end=${endMonth}"`}
        />

        <DatasetCoverCard
          title="Monthly series and anomalies"
          category="CSV • ANALYTICS"
          format="CSV"
          filename={`prometheus375_analytics_${area.presetId || 'custom'}.csv`}
          downloadUrl={analyticsExport.url}
          downloadLabel={analyticsExport.isMock ? 'Sample CSV' : 'Download CSV'}
          isMock={analyticsExport.isMock}
          isDisabled={backendDown}
          disabledLabel="Offline"
          disabledNote={downNote}
          preparingNote="Preparing your CSV…"
          description="Integrated monthly burning series for your area, with each month's historical normal: median, p10–p90 band, z-score and percentile."
          fields={['count', 'source', 'median', 'p10-p90', 'z-score', 'percentile']}
          sampleCurl={`curl "${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/export_analytics.csv"`}
        />

        <DatasetCoverCard
          title="Holdout-year error metrics"
          category="JSON • VALIDATION"
          format="JSON"
          filename="prometheus375_validation_metrics.json"
          downloadUrl={
            !isMockMode
              ? `${import.meta.env.VITE_API_URL}/validation`
              : // /src paths only exist on the Vite dev server — embed the sample instead
                `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(mockValidation, null, 2))}`
          }
          downloadLabel={isMockMode ? 'Download Sample JSON' : 'Download JSON'}
          isMock={valIsMock}
          isDisabled={!isMockMode && (isVal404 || backendDown)}
          disabledLabel={backendDown ? 'Offline' : 'Available soon'}
          disabledNote={backendDown ? downNote : 'Endpoint not published yet'}
          description="Validation benchmarking on the 2020 cross-satellite holdout year including Mean Absolute Percentage Error (MAPE) proof."
          fields={['holdout_year', 'MAE', 'MAPE', 'before/after series']}
          sampleCurl={`curl "${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/validation"`}
        />
      </div>
    </div>
  );
};
