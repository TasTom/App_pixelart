import { useEditorStore } from '../state/store';
import type { ToolId } from '../types';

const TOOL_LABELS: Record<ToolId, string> = {
  pencil: 'Stylo',
  eraser: 'Gomme',
  fill: 'Remplissage',
  line: 'Ligne',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  eyedropper: 'Pipette',
  select: 'Sélection',
  pan: 'Déplacement',
};

export function StatusBar() {
  const cursorX = useEditorStore((s) => s.cursorX);
  const cursorY = useEditorStore((s) => s.cursorY);
  const zoom = useEditorStore((s) => s.zoom);
  const tool = useEditorStore((s) => s.tool);
  const docName = useEditorStore((s) => s.doc.name);
  const docW = useEditorStore((s) => s.doc.width);
  const docH = useEditorStore((s) => s.doc.height);
  const editingTile = useEditorStore((s) => s.editingTile);
  const setUi = useEditorStore((s) => s.setUi);

  const fit = () => {
    window.dispatchEvent(new CustomEvent('pixelforge-fit'));
  };

  return (
    <footer className="statusbar">
      <span className="status-item strong">{docName}</span>
      <span className="status-item">
        {editingTile !== null
          ? `Tile #${editingTile + 1} en édition`
          : `${docW} × ${docH} px`}
      </span>
      <span className="status-item">
        {cursorX >= 0 ? `x: ${cursorX}  y: ${cursorY}` : 'x: –  y: –'}
      </span>
      <span className="status-item">Outil : {TOOL_LABELS[tool]}</span>
      <span className="spacer" />
      <span className="status-item zoom-controls">
        <button type="button" onClick={() => setUi({ zoom: Math.max(0.5, zoom / 1.25) })}>
          −
        </button>
        <span className="zoom-value">{Math.round(zoom * 100)} %</span>
        <button type="button" onClick={() => setUi({ zoom: Math.min(64, zoom * 1.25) })}>
          +
        </button>
        <button type="button" onClick={fit}>
          Ajuster
        </button>
      </span>
      <span className="status-item dim">Ctrl+Z annuler · Ctrl+S enregistrer</span>
    </footer>
  );
}
