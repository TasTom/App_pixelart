import { useRef, useState } from 'react';
import { useEditorStore } from '../state/store';
import {
  exportGif,
  exportPngFrame,
  exportProject,
  exportSpritesheet,
  exportTiled,
  parseProject,
} from '../export/exporters';

export function TopBar() {
  const undoCount = useEditorStore((s) => s.undoStack.length);
  const redoCount = useEditorStore((s) => s.redoStack.length);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const setUi = useEditorStore((s) => s.setUi);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScale, setExportScale] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const runExport = async (fn: () => Promise<void> | void) => {
    setExportOpen(false);
    try {
      await fn();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "L'export a échoué.");
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">▦</span> PixelForge
      </div>

      <div className="topbar-group">
        <button type="button" onClick={() => setUi({ newDialogOpen: true })}>
          Nouveau
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Ouvrir
        </button>
        <button type="button" onClick={() => exportProject(useEditorStore.getState().doc)}>
          Enregistrer
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              const text = await file.text();
              useEditorStore.getState().loadDoc(parseProject(text));
            } catch (err) {
              window.alert(
                err instanceof Error ? err.message : 'Fichier illisible.',
              );
            }
          }}
        />
      </div>

      <div className="topbar-group">
        <button type="button" disabled={undoCount === 0} onClick={undo}>
          Annuler
        </button>
        <button type="button" disabled={redoCount === 0} onClick={redo}>
          Rétablir
        </button>
      </div>

      <div className="topbar-group relative">
        <button
          type="button"
          className={exportOpen ? 'active' : ''}
          onClick={() => setExportOpen(!exportOpen)}
        >
          Exporter ▾
        </button>
        {exportOpen && (
          <>
            <div className="dropdown-overlay" onClick={() => setExportOpen(false)} />
            <div className="dropdown">
              <label className="dropdown-scale">
                Échelle
                <select
                  value={exportScale}
                  onChange={(e) => setExportScale(Number(e.target.value))}
                >
                  <option value={1}>1×</option>
                  <option value={2}>2×</option>
                  <option value={4}>4×</option>
                  <option value={8}>8×</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() =>
                  runExport(() =>
                    exportPngFrame(
                      useEditorStore.getState().doc,
                      useEditorStore.getState().currentFrame,
                      exportScale,
                    ),
                  )
                }
              >
                PNG (image courante)
              </button>
              <button
                type="button"
                onClick={() =>
                  runExport(() =>
                    exportSpritesheet(useEditorStore.getState().doc, {
                      scale: exportScale,
                    }),
                  )
                }
              >
                Planche de sprites PNG + JSON
              </button>
              <button
                type="button"
                onClick={() =>
                  runExport(() => exportGif(useEditorStore.getState().doc, exportScale))
                }
              >
                GIF animé
              </button>
              <button
                type="button"
                onClick={() =>
                  runExport(() => exportTiled(useEditorStore.getState().doc))
                }
              >
                Tilemap JSON Tiled + PNG
              </button>
              <button
                type="button"
                onClick={() => runExport(() => exportProject(useEditorStore.getState().doc))}
              >
                Projet (.json)
              </button>
            </div>
          </>
        )}
      </div>

      <span className="spacer" />
      <span className="dim topbar-note">
        Pixel art · animations · tilemaps
      </span>
    </header>
  );
}
