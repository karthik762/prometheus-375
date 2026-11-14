import React, { useState } from 'react';
import { useSelection } from '../../hooks/useSelection';
import { useValidation } from '../../hooks/useValidation';
import { getExportHotspotsCsvUrl, getExportAnalyticsCsvUrl, isOfflineMockMode } from '../../api/api';
import { SampleDataBadge } from '../ui/SampleDataBadge';

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
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

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
                Available soon
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
            ? 'Endpoint not published yet'
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
            Available soon
          </span>
        ) : (
          <a
            href={downloadUrl}
            download={filename}
            onClick={(e) => e.stopPropagation()}
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
          description="Cell-level monthly active fire counts cross-calibrated between MODIS and VIIRS with empirical uncertainty intervals."
          fields={['lat', 'lon', 'date', 'sensor', 'confidence']}
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
          description="Integrated monthly burning series with historical normal baseline medians, percentiles, and seasonal onset shift days."
          fields={['count', 'median', 'p10-p90', 'z-score']}
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
              : '/src/api/mock/validation.json'
          }
          downloadLabel={isMockMode ? 'Download Sample JSON' : 'Download JSON'}
          isMock={valIsMock}
          isDisabled={!isMockMode && isVal404}
          description="Validation benchmarking on the 2020 cross-satellite holdout year including Mean Absolute Percentage Error (MAPE) proof."
          fields={['before/after series', 'MAE', 'bias']}
          sampleCurl={`curl "${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/validation"`}
        />
      </div>
    </div>
  );
};
