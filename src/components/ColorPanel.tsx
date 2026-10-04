import { useState } from 'react';
import { normalizeHexInput } from '../utils/color';
import { PALETTE_PRESETS } from '../utils/palettes';
import { useEditorStore } from '../state/store';

export function ColorPanel() {
  const primary = useEditorStore((s) => s.primaryColor);
  const secondary = useEditorStore((s) => s.secondaryColor);
  const palette = useEditorStore((s) => s.doc.palette);
  const setUi = useEditorStore((s) => s.setUi);
  const setPalette = useEditorStore((s) => s.setPalette);
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [presetIndex, setPresetIndex] = useState(-1);

  const commitHex = (value: string) => {
    const hex = normalizeHexInput(value);
    if (hex) setUi({ primaryColor: hex });
    setHexDraft(null);
  };

  return (
    <section className="panel">
      <div className="panel-title">Couleurs</div>

      <div className="color-current">
        <div className="swatch-stack">
          <label
            className="swatch swatch-secondary"
            style={{ background: secondary }}
            title="Couleur secondaire (clic droit sur le canvas)"
          >
            <input
              type="color"
              value={secondary}
              onChange={(e) => setUi({ secondaryColor: e.target.value })}
            />
          </label>
          <label
            className="swatch swatch-primary"
            style={{ background: primary }}
            title="Couleur primaire (clic gauche sur le canvas)"
          >
            <input
              type="color"
              value={primary}
              onChange={(e) => setUi({ primaryColor: e.target.value })}
            />
          </label>
        </div>

        <div className="color-fields">
          <input
            className="hex-input"
            type="text"
            spellCheck={false}
            value={hexDraft ?? primary}
            onChange={(e) => setHexDraft(e.target.value)}
            onBlur={(e) => commitHex(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitHex(e.currentTarget.value);
            }}
          />
          <button
            type="button"
            className="small"
            title="Inverser primaire / secondaire (X)"
            onClick={() =>
              setUi({ primaryColor: secondary, secondaryColor: primary })
            }
          >
            ⇄ Inverser
          </button>
        </div>
      </div>

      <div className="palette-toolbar">
        <select
          value={presetIndex}
          onChange={(e) => {
            const index = Number(e.target.value);
            setPresetIndex(index);
            if (index >= 0) setPalette(PALETTE_PRESETS[index].colors);
          }}
        >
          <option value={-1}>Palette du document</option>
          {PALETTE_PRESETS.map((p, i) => (
            <option key={p.name} value={i}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="palette-grid">
        {palette.map((hex, i) => (
          <button
            key={`${hex}-${i}`}
            type="button"
            className={`palette-swatch ${primary === hex ? 'active' : ''}`}
            style={{ background: hex }}
            title={`${hex} — clic : primaire, clic droit : secondaire`}
            onClick={() => setUi({ primaryColor: hex })}
            onContextMenu={(e) => {
              e.preventDefault();
              setUi({ secondaryColor: hex });
            }}
          />
        ))}
      </div>

      <div className="row gap">
        <button
          type="button"
          className="small"
          onClick={() => {
            if (!palette.includes(primary)) setPalette([...palette, primary]);
          }}
        >
          + Ajouter la couleur
        </button>
        <button
          type="button"
          className="small"
          onClick={() => {
            const index = palette.lastIndexOf(primary);
            if (index >= 0) {
              const copy = [...palette];
              copy.splice(index, 1);
              setPalette(copy);
            }
          }}
        >
          − Retirer
        </button>
      </div>
    </section>
  );
}
