import { useState } from 'react';
import {
  DEFAULT_TILE_SIZE,
  PRESET_SIZES,
  TILE_SIZE_CHOICES,
} from '../core/document';
import { useEditorStore } from '../state/store';

export function NewDocDialog() {
  const open = useEditorStore((s) => s.newDialogOpen);
  const newDoc = useEditorStore((s) => s.newDoc);
  const setUi = useEditorStore((s) => s.setUi);

  const [name, setName] = useState('Sans titre');
  const [size, setSize] = useState(64);
  const [customW, setCustomW] = useState(64);
  const [customH, setCustomH] = useState(64);
  const [useCustom, setUseCustom] = useState(false);
  const [tileSize, setTileSize] = useState(DEFAULT_TILE_SIZE);

  if (!open) return null;

  const create = () => {
    const w = useCustom ? customW : size;
    const h = useCustom ? customH : size;
    newDoc(name, w, h, tileSize);
    setUi({ newDialogOpen: false });
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-label="Nouveau document">
        <h2>Nouveau document</h2>

        <label className="field">
          <span>Nom</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
        </label>

        <div className="field">
          <span>Format</span>
          <div className="size-presets">
            {PRESET_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                className={!useCustom && size === s ? 'active' : ''}
                onClick={() => {
                  setSize(s);
                  setUseCustom(false);
                }}
              >
                {s}×{s}
              </button>
            ))}
            <button
              type="button"
              className={useCustom ? 'active' : ''}
              onClick={() => setUseCustom(true)}
            >
              Personnalisé
            </button>
          </div>
        </div>

        {useCustom && (
          <div className="field">
            <span>Dimensions (px)</span>
            <div className="row">
              <input
                type="number"
                min={1}
                max={2048}
                value={customW}
                onChange={(e) => setCustomW(Number(e.target.value))}
              />
              <span className="dim">×</span>
              <input
                type="number"
                min={1}
                max={2048}
                value={customH}
                onChange={(e) => setCustomH(Number(e.target.value))}
              />
            </div>
          </div>
        )}

        <label className="field">
          <span>Taille des tiles (tilemap)</span>
          <select
            value={tileSize}
            onChange={(e) => setTileSize(Number(e.target.value))}
          >
            {TILE_SIZE_CHOICES.map((t) => (
              <option key={t} value={t}>
                {t} × {t} px
              </option>
            ))}
          </select>
        </label>

        <div className="modal-actions">
          <button type="button" onClick={() => setUi({ newDialogOpen: false })}>
            Annuler
          </button>
          <button type="button" className="primary" onClick={create}>
            Créer
          </button>
        </div>
      </div>
    </div>
  );
}
