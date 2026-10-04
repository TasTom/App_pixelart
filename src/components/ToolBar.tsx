import type { ToolId } from '../types';
import { useEditorStore } from '../state/store';

interface ToolDef {
  id: ToolId;
  label: string;
  shortcut: string;
}

const TOOLS: ToolDef[] = [
  { id: 'pencil', label: 'Stylo', shortcut: 'B' },
  { id: 'eraser', label: 'Gomme', shortcut: 'E' },
  { id: 'fill', label: 'Remplissage', shortcut: 'G' },
  { id: 'line', label: 'Ligne', shortcut: 'L' },
  { id: 'rect', label: 'Rectangle', shortcut: 'R' },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O' },
  { id: 'eyedropper', label: 'Pipette', shortcut: 'I' },
  { id: 'select', label: 'Sélection', shortcut: 'M' },
  { id: 'pan', label: 'Déplacement', shortcut: 'H' },
];

const BRUSH_SIZES = [1, 2, 3, 4, 6, 8];

export function ToolBar() {
  const tool = useEditorStore((s) => s.tool);
  const brushSize = useEditorStore((s) => s.brushSize);
  const shapeFilled = useEditorStore((s) => s.shapeFilled);
  const setUi = useEditorStore((s) => s.setUi);
  const isShape = tool === 'rect' || tool === 'ellipse';

  return (
    <aside className="toolbar">
      <div className="panel-title">Outils</div>
      <div className="tool-list">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tool-btn ${tool === t.id ? 'active' : ''}`}
            onClick={() => setUi({ tool: t.id })}
          >
            <span>{t.label}</span>
            <kbd>{t.shortcut}</kbd>
          </button>
        ))}
      </div>

      <div className="panel-title">Taille de brosse</div>
      <div className="brush-sizes">
        {BRUSH_SIZES.map((s) => (
          <button
            key={s}
            type="button"
            className={brushSize === s ? 'active' : ''}
            onClick={() => setUi({ brushSize: s })}
          >
            {s}
          </button>
        ))}
      </div>
      <input
        className="slider"
        type="range"
        min={1}
        max={16}
        value={brushSize}
        onChange={(e) => setUi({ brushSize: Number(e.target.value) })}
      />

      {isShape && (
        <label className="check-row">
          <input
            type="checkbox"
            checked={shapeFilled}
            onChange={(e) => setUi({ shapeFilled: e.target.checked })}
          />
          Forme remplie
        </label>
      )}

      <div className="hint">
        Shift : contraindre la forme
        <br />
        Clic droit : couleur secondaire
        <br />
        Molette : zoom · Espace : déplacer
      </div>
    </aside>
  );
}
