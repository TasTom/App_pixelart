import { useState } from 'react';
import { useEditorStore } from '../state/store';

export function LayersPanel() {
  const doc = useEditorStore((s) => s.doc);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const setUi = useEditorStore((s) => s.setUi);
  const addLayer = useEditorStore((s) => s.addLayer);
  const removeLayer = useEditorStore((s) => s.removeLayer);
  const duplicateLayer = useEditorStore((s) => s.duplicateLayer);
  const moveLayer = useEditorStore((s) => s.moveLayer);
  const setLayerOpacity = useEditorStore((s) => s.setLayerOpacity);
  const toggleLayerVisible = useEditorStore((s) => s.toggleLayerVisible);
  const toggleLayerLocked = useEditorStore((s) => s.toggleLayerLocked);
  const renameLayer = useEditorStore((s) => s.renameLayer);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const active = doc.layers.find((l) => l.id === activeLayerId);
  const rows = doc.layers.slice().reverse();

  return (
    <section className="panel">
      <div className="panel-title">Calques</div>

      <div className="layer-list">
        {rows.map((layer) => (
          <div
            key={layer.id}
            className={`layer-row ${layer.id === activeLayerId ? 'active' : ''}`}
            onClick={() => setUi({ activeLayerId: layer.id })}
          >
            <button
              type="button"
              className="icon-btn"
              title={layer.visible ? 'Masquer' : 'Afficher'}
              onClick={(e) => {
                e.stopPropagation();
                toggleLayerVisible(layer.id);
              }}
            >
              {layer.visible ? '◉' : '◌'}
            </button>

            {editingId === layer.id ? (
              <input
                className="layer-name-input"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  renameLayer(layer.id, draft);
                  setEditingId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    renameLayer(layer.id, draft);
                    setEditingId(null);
                  }
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="layer-name"
                onDoubleClick={() => {
                  setDraft(layer.name);
                  setEditingId(layer.id);
                }}
                title="Double-clic pour renommer"
              >
                {layer.name}
              </span>
            )}

            <span className={`badge ${layer.type}`}>
              {layer.type === 'tilemap' ? 'Tilemap' : 'Raster'}
            </span>

            <button
              type="button"
              className="icon-btn"
              title={layer.locked ? 'Déverrouiller' : 'Verrouiller'}
              onClick={(e) => {
                e.stopPropagation();
                toggleLayerLocked(layer.id);
              }}
            >
              {layer.locked ? '🔒' : '·'}
            </button>
          </div>
        ))}
      </div>

      <div className="row gap wrap">
        <button type="button" className="small" onClick={() => addLayer('raster')}>
          + Raster
        </button>
        <button type="button" className="small" onClick={() => addLayer('tilemap')}>
          + Tilemap
        </button>
        <button
          type="button"
          className="small"
          onClick={() => duplicateLayer(activeLayerId)}
        >
          Dupliquer
        </button>
        <button
          type="button"
          className="small"
          disabled={doc.layers.length <= 1}
          onClick={() => removeLayer(activeLayerId)}
        >
          Supprimer
        </button>
        <button
          type="button"
          className="small"
          title="Monter"
          onClick={() => moveLayer(activeLayerId, 1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="small"
          title="Descendre"
          onClick={() => moveLayer(activeLayerId, -1)}
        >
          ↓
        </button>
      </div>

      {active && (
        <label className="field inline">
          <span>Opacité {Math.round(active.opacity * 100)} %</span>
          <input
            className="slider"
            type="range"
            min={0}
            max={100}
            value={Math.round(active.opacity * 100)}
            onChange={(e) =>
              setLayerOpacity(active.id, Number(e.target.value) / 100)
            }
          />
        </label>
      )}
    </section>
  );
}
