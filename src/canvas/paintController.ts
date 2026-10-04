import type {
  HistoryPatch,
  PaintTarget,
  Point,
  RasterLayer,
  TilemapFrame,
  TilemapLayer,
  ToolId,
} from '../types';
import { useEditorStore } from '../state/store';
import { dataChanged, getPacked } from '../utils/pixels';
import { hexToPacked, packedToHex } from '../utils/color';
import {
  applyBrush,
  constrainShape,
  drawEllipseOnBuffer,
  drawLineOnBuffer,
  drawRectOnBuffer,
  floodFillBuffer,
  floodFillCells,
  setCell,
} from '../core/drawOps';
import {
  findLayer,
  getRasterTargetBuffer,
  getTilemapTargetFrame,
} from '../core/document';
import { flattenFrame } from '../core/compose';
import { rasterPatch, tilemapPatch } from '../core/history';

interface StrokeState {
  tool: ToolId;
  target: PaintTarget;
  secondary: boolean;
  startPos: Point;
  lastPos: Point;
  beforeRaster: Uint8ClampedArray | null;
  beforeCells: Int32Array | null;
}

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

/** Trace une ligne de cellules (Bresenham sur la grille de tilemap). */
function strokeCells(
  frame: TilemapFrame,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  value: number,
): void {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x);
  const sx = x < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y);
  const sy = y < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    setCell(frame, x, y, value);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * Gère les interactions de dessin : capture l'état avant le trait,
 * applique l'outil, puis commit l'historique à la fin du trait.
 * Les mutations se font en place sur le document du store (sans re-rendu React),
 * le canvas est redessiné par le callback `redraw`.
 */
export class PaintController {
  private stroke: StrokeState | null = null;
  private redraw: () => void;

  constructor(redraw: () => void) {
    this.redraw = redraw;
  }

  isDrawing(): boolean {
    return this.stroke !== null;
  }

  private toGrid(p: Point): Point {
    const ts = useEditorStore.getState().doc.tileset.tileSize;
    return {
      x: Math.floor(p.x / ts),
      y: Math.floor(p.y / ts),
    };
  }

  pointerDown(p: Point, secondary: boolean): void {
    const state = useEditorStore.getState();
    if (this.stroke) return;
    const tool = state.tool;

    if (tool === 'eyedropper') {
      this.pickColor(p, secondary);
      return;
    }
    if (tool === 'select') return;

    const target: PaintTarget =
      state.editingTile !== null
        ? { kind: 'tile', tileIndex: state.editingTile }
        : {
            kind: 'layer',
            layerId: state.activeLayerId,
            frameIndex: state.currentFrame,
          };

    if (target.kind === 'layer') {
      const layer = findLayer(state.doc, target.layerId);
      if (!layer || layer.locked || !layer.visible) return;
    }

    const activeLayer =
      target.kind === 'layer' ? findLayer(state.doc, target.layerId) : undefined;
    const isTilemapTarget = activeLayer?.type === 'tilemap';

    let beforeRaster: Uint8ClampedArray | null = null;
    let beforeCells: Int32Array | null = null;

    if (isTilemapTarget) {
      const frame = getTilemapTargetFrame(state.doc, target);
      if (!frame) return;
      beforeCells = new Int32Array(frame.cells);
      const value = secondary ? -1 : state.selectedTile;
      const g = this.toGrid(p);
      if (tool === 'fill') {
        floodFillCells(frame, g.x, g.y, value);
      } else if (tool === 'pencil' || tool === 'eraser') {
        setCell(frame, g.x, g.y, tool === 'eraser' ? -1 : value);
      }
    } else {
      const buf = getRasterTargetBuffer(state.doc, target);
      if (!buf) return;
      beforeRaster = new Uint8ClampedArray(buf.data);
      const packed = hexToPacked(
        tool === 'eraser' ? '#00000000' : secondary ? state.secondaryColor : state.primaryColor,
      );
      if (tool === 'pencil' || tool === 'eraser') {
        applyBrush(buf, p.x, p.y, state.brushSize, packed);
      } else if (tool === 'fill') {
        floodFillBuffer(buf, p.x, p.y, packed);
      }
    }

    this.stroke = {
      tool,
      target,
      secondary,
      startPos: p,
      lastPos: p,
      beforeRaster,
      beforeCells,
    };
    this.redraw();
  }

  pointerMove(p: Point, shift: boolean): void {
    const stroke = this.stroke;
    if (!stroke) return;
    const state = useEditorStore.getState();
    const tool = stroke.tool;

    if (tool === 'pencil' || tool === 'eraser') {
      if (stroke.beforeCells) {
        const frame = getTilemapTargetFrame(state.doc, stroke.target);
        if (!frame) return;
        const value = tool === 'eraser' ? -1 : state.selectedTile;
        const g0 = this.toGrid(stroke.lastPos);
        const g1 = this.toGrid(p);
        strokeCells(frame, g0.x, g0.y, g1.x, g1.y, value);
      } else if (stroke.beforeRaster) {
        const buf = getRasterTargetBuffer(state.doc, stroke.target);
        if (!buf) return;
        const packed = hexToPacked(
          tool === 'eraser'
            ? '#00000000'
            : stroke.secondary
              ? state.secondaryColor
              : state.primaryColor,
        );
        drawLineOnBuffer(
          buf,
          stroke.lastPos.x,
          stroke.lastPos.y,
          p.x,
          p.y,
          state.brushSize,
          packed,
        );
      }
      stroke.lastPos = p;
      this.redraw();
      return;
    }

    if (tool === 'line' || tool === 'rect' || tool === 'ellipse') {
      const end = shift ? constrainShape(tool, stroke.startPos, p) : p;
      // Les formes ne s'appliquent qu'aux calques raster et aux tiles.
      if (stroke.beforeCells) return;
      const buf = getRasterTargetBuffer(state.doc, stroke.target);
      if (!buf || !stroke.beforeRaster) return;
      buf.data.set(stroke.beforeRaster);
      const packed = hexToPacked(
        stroke.secondary ? state.secondaryColor : state.primaryColor,
      );
      const size = state.brushSize;
      if (tool === 'line') {
        drawLineOnBuffer(
          buf,
          stroke.startPos.x,
          stroke.startPos.y,
          end.x,
          end.y,
          size,
          packed,
        );
      } else if (tool === 'rect') {
        drawRectOnBuffer(
          buf,
          stroke.startPos.x,
          stroke.startPos.y,
          end.x,
          end.y,
          packed,
          state.shapeFilled,
          size,
        );
      } else {
        drawEllipseOnBuffer(
          buf,
          stroke.startPos.x,
          stroke.startPos.y,
          end.x,
          end.y,
          packed,
          state.shapeFilled,
          size,
        );
      }
      stroke.lastPos = end;
      this.redraw();
    }
  }

  pointerUp(p: Point, shift: boolean): void {
    const stroke = this.stroke;
    if (!stroke) return;
    if (
      stroke.tool === 'line' ||
      stroke.tool === 'rect' ||
      stroke.tool === 'ellipse'
    ) {
      this.pointerMove(p, shift);
    }
    this.finishStroke();
  }

  /** Annule le trait en cours et restaure l'état précédent. */
  cancel(): void {
    const stroke = this.stroke;
    if (!stroke) return;
    const state = useEditorStore.getState();
    if (stroke.beforeRaster) {
      const buf = getRasterTargetBuffer(state.doc, stroke.target);
      if (buf) buf.data.set(stroke.beforeRaster);
    } else if (stroke.beforeCells) {
      const frame = getTilemapTargetFrame(state.doc, stroke.target);
      if (frame) frame.cells.set(stroke.beforeCells);
    }
    this.stroke = null;
    this.redraw();
  }

  private finishStroke(): void {
    const stroke = this.stroke;
    if (!stroke) return;
    const state = useEditorStore.getState();
    let patch: HistoryPatch | null = null;

    if (stroke.beforeCells) {
      const frame = getTilemapTargetFrame(state.doc, stroke.target);
      if (frame && dataChanged(stroke.beforeCells, frame.cells)) {
        patch = tilemapPatch(
          stroke.target.kind === 'layer' ? stroke.target.layerId : '',
          stroke.target.kind === 'layer' ? stroke.target.frameIndex : 0,
          stroke.beforeCells,
          new Int32Array(frame.cells),
        );
      }
    } else if (stroke.beforeRaster) {
      const buf = getRasterTargetBuffer(state.doc, stroke.target);
      if (buf && dataChanged(stroke.beforeRaster, buf.data)) {
        patch = rasterPatch(
          stroke.target,
          stroke.beforeRaster,
          new Uint8ClampedArray(buf.data),
        );
      }
    }

    this.stroke = null;
    if (patch) {
      state.commitHistory({
        label: TOOL_LABELS[stroke.tool],
        patches: [patch],
      });
    }
    this.redraw();
  }

  /**
   * Efface la sélection (ou toute la surface sans sélection) sur la
   * cible de peinture active (raccourci Suppr).
   */
  clearSelection(): void {
    const state = useEditorStore.getState();
    const surfW =
      state.editingTile !== null
        ? state.doc.tileset.tileSize
        : state.doc.width;
    const surfH =
      state.editingTile !== null
        ? state.doc.tileset.tileSize
        : state.doc.height;
    const sel = state.selection ?? { x: 0, y: 0, w: surfW, h: surfH };

    const target: PaintTarget =
      state.editingTile !== null
        ? { kind: 'tile', tileIndex: state.editingTile }
        : {
            kind: 'layer',
            layerId: state.activeLayerId,
            frameIndex: state.currentFrame,
          };

    if (target.kind === 'layer') {
      const layer = findLayer(state.doc, target.layerId);
      if (!layer || layer.locked || !layer.visible) return;
    }

    const x0 = Math.max(0, Math.floor(sel.x));
    const y0 = Math.max(0, Math.floor(sel.y));
    const x1 = Math.floor(sel.x + sel.w);
    const y1 = Math.floor(sel.y + sel.h);

    const layerInfo =
      target.kind === 'layer'
        ? (findLayer(state.doc, target.layerId) as RasterLayer | TilemapLayer | undefined)
        : undefined;

    if (layerInfo && layerInfo.type === 'tilemap') {
      const frame = getTilemapTargetFrame(state.doc, target);
      if (!frame) return;
      const before = new Int32Array(frame.cells);
      const ts = state.doc.tileset.tileSize;
      for (let y = Math.floor(y0 / ts); y < Math.ceil(y1 / ts); y++) {
        for (let x = Math.floor(x0 / ts); x < Math.ceil(x1 / ts); x++) {
          setCell(frame, x, y, -1);
        }
      }
      if (dataChanged(before, frame.cells)) {
        state.commitHistory({
          label: 'Effacer la sélection',
          patches: [
            tilemapPatch(
              target.kind === 'layer' ? target.layerId : '',
              target.kind === 'layer' ? target.frameIndex : 0,
              before,
              new Int32Array(frame.cells),
            ),
          ],
        });
      }
    } else {
      const buf = getRasterTargetBuffer(state.doc, target);
      if (!buf) return;
      const before = new Uint8ClampedArray(buf.data);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) continue;
          const i = (y * buf.width + x) * 4;
          buf.data[i] = 0;
          buf.data[i + 1] = 0;
          buf.data[i + 2] = 0;
          buf.data[i + 3] = 0;
        }
      }
      if (dataChanged(before, buf.data)) {
        state.commitHistory({
          label: 'Effacer la sélection',
          patches: [rasterPatch(target, before, new Uint8ClampedArray(buf.data))],
        });
      }
    }
    this.redraw();
  }

  private pickColor(p: Point, secondary: boolean): void {
    const state = useEditorStore.getState();
    let packed = 0;
    if (state.editingTile !== null) {
      const tile = state.doc.tileset.tiles[state.editingTile];
      if (!tile) return;
      packed = getPacked(tile, p.x, p.y);
    } else {
      const flat = flattenFrame(state.doc, state.currentFrame);
      packed = getPacked(flat, p.x, p.y);
    }
    if ((packed >>> 24) === 0) return;
    const hex = packedToHex(packed).slice(0, 7);
    useEditorStore
      .getState()
      .setUi(secondary ? { secondaryColor: hex } : { primaryColor: hex });
  }
}
