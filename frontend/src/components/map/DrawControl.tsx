import React from 'react';
import { Button } from '../ui/Button';

interface DrawControlProps {
  activeMode: string;
  onSetMode: (mode: 'polygon' | 'rectangle' | 'select' | 'static') => void;
  onClear: () => void;
  hasDrawnFeature: boolean;
}

export const DrawControl: React.FC<DrawControlProps> = ({
  activeMode,
  onSetMode,
  onClear,
  hasDrawnFeature,
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div className="label-mono" style={{ color: 'var(--color-text-secondary)' }}>
        Custom Area Selection
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
        <Button
          type="button"
          size="sm"
          variant={activeMode === 'polygon' ? 'primary' : 'secondary'}
          onClick={() => onSetMode(activeMode === 'polygon' ? 'static' : 'polygon')}
          aria-pressed={activeMode === 'polygon'}
        >
          {activeMode === 'polygon' ? 'Drawing…' : 'Draw Polygon'}
        </Button>

        <Button
          type="button"
          size="sm"
          variant={activeMode === 'rectangle' ? 'primary' : 'secondary'}
          onClick={() => onSetMode(activeMode === 'rectangle' ? 'static' : 'rectangle')}
          aria-pressed={activeMode === 'rectangle'}
        >
          {activeMode === 'rectangle' ? 'Drawing…' : 'Draw Box'}
        </Button>
      </div>

      <div style={{ display: 'flex', gap: '6px' }}>
        <Button
          type="button"
          size="sm"
          variant={activeMode === 'select' ? 'primary' : 'secondary'}
          onClick={() => onSetMode(activeMode === 'select' ? 'static' : 'select')}
          style={{ flex: 1 }}
          aria-pressed={activeMode === 'select'}
        >
          Edit Shape
        </Button>

        {hasDrawnFeature && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onClear}
            style={{ color: 'var(--color-error)' }}
          >
            Clear
          </Button>
        )}
      </div>

      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', lineHeight: 1.4 }}>
        {activeMode === 'polygon' && 'Click points on the map. Double-click or click the start point to close the polygon.'}
        {activeMode === 'rectangle' && 'Click and drag on the map to define a bounding rectangle.'}
        {activeMode === 'select' && 'Click on the polygon to drag vertices or reposition.'}
        {activeMode === 'static' && 'Polygon tool idle. Select a draw tool above to outline an area.'}
      </div>
    </div>
  );
};
