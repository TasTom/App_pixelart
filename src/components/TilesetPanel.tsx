import { useEffect, useRef } from 'react';
import { drawCheckerboard } from '../canvas/compositor';
import { useEditorStore } from '../state/store';

function TileThumb({ index }: { index: number }) {
  const docRev = useEditorStore((s) => s.docRev);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const tile = useEditorStore.getState().doc.tileset.tiles[index];
    if (!tile) return;
    const size = 46;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawCheckerboard(ctx, 0, 0, size, size, 6);
    const tmp = document.createElement('canvas');
    tmp.width = tile.width;
    tmp.height = tile.height;
    const tctx = tmp.getContext('2d');
    if (!tctx) return;
    tctx.putImageData(new ImageData(tile.data, tile.width, tile.height), 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, size, size);
  }, [index, docRev]);

  return <canvas ref={ref} className="thumb-canvas" />;
}

export function TilesetPanel() {
  const tileSize = useEditorStore((s) => s.doc.tileset.tileSize);
  const tileCount = useEditorStore((s) => s.doc.tileset.tiles.length);
  const selectedTile = useEditorStore((s) => s.selectedTile);
  const editingTile = useEditorStore((s) => s.editingTile);
  const setUi = useEditorStore((s) => s.setUi);
  const addTile = useEditorStore((s) => s.addTile);
  const duplicateTile = useEditorStore((s) => s.duplicateTile);
  const deleteTile = useEditorStore((s) => s.deleteTile);

  const indices = Array.from({ length: tileCount }, (_, i) => i);

  return (
    <section className="panel">
      <div className="panel-title">
        Tileset ({tileSize}×{tileSize})
      </div>

      <div className="tile-grid">
        {indices.map((i) => (
          <button
            key={i}
            type="button"
            className={`tile-btn ${selectedTile === i ? 'active' : ''} ${
              editingTile === i ? 'editing' : ''
            }`}
            onClick={() => setUi({ selectedTile: i })}
            onDoubleClick={() =>
              setUi({ editingTile: editingTile === i ? null : i })
            }
            title="Clic : sélectionner · Double-clic : éditer la tile"
          >
            <TileThumb index={i} />
            <span className="tile-index">{i + 1}</span>
          </button>
        ))}
      </div>

      <div className="row gap wrap">
        <button type="button" className="small" onClick={addTile}>
          + Tile
        </button>
        <button
          type="button"
          className="small"
          onClick={() => duplicateTile(selectedTile)}
        >
          Dupliquer
        </button>
        <button
          type="button"
          className="small"
          disabled={tileCount <= 1}
          onClick={() => deleteTile(selectedTile)}
        >
          Supprimer
        </button>
        <button
          type="button"
          className="small"
          onClick={() =>
            setUi({ editingTile: editingTile !== null ? null : selectedTile })
          }
        >
          {editingTile !== null ? '✓ Terminer l\'édition' : 'Éditer la tile'}
        </button>
      </div>

      <div className="hint">
        Avec un calque tilemap actif, le stylo pose la tile sélectionnée (clic
        droit : effacer).
      </div>
    </section>
  );
}
