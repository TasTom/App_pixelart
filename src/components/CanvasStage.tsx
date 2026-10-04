import { useCallback, useEffect, useRef } from 'react';
import type { Point, Rect } from '../types';
import { useEditorStore } from '../state/store';
import { PaintController } from '../canvas/paintController';
import {
  drawCheckerboard,
  renderBufferToCanvas,
  renderFrameToCanvas,
} from '../canvas/compositor';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function CanvasStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const onionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const panRef = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const selectRef = useRef<Point | null>(null);
  const spaceRef = useRef(false);

  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const docRev = useEditorStore((s) => s.docRev);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const onionSkin = useEditorStore((s) => s.onionSkin);
  const showGrid = useEditorStore((s) => s.showGrid);
  const selection = useEditorStore((s) => s.selection);
  const editingTile = useEditorStore((s) => s.editingTile);
  const tool = useEditorStore((s) => s.tool);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const state = useEditorStore.getState();
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(rect.width * dpr));
    const ch = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#14141a';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.imageSmoothingEnabled = false;

    const { doc, currentFrame: cf, editingTile: et } = state;
    const z = state.zoom;
    const px = state.panX;
    const py = state.panY;

    if (!frameCanvasRef.current) {
      frameCanvasRef.current = document.createElement('canvas');
    }
    if (!onionCanvasRef.current) {
      onionCanvasRef.current = document.createElement('canvas');
    }
    const frameCanvas = frameCanvasRef.current;
    const onionCanvas = onionCanvasRef.current;

    const surfW = et !== null ? doc.tileset.tileSize : doc.width;
    const surfH = et !== null ? doc.tileset.tileSize : doc.height;
    const drawW = surfW * z;
    const drawH = surfH * z;

    drawCheckerboard(ctx, px, py, drawW, drawH, 8);

    if (et === null && state.onionSkin && doc.frames.length > 1) {
      if (cf > 0) {
        renderFrameToCanvas(doc, cf - 1, onionCanvas);
        ctx.globalAlpha = 0.25;
        ctx.drawImage(onionCanvas, px, py, drawW, drawH);
      }
      if (cf < doc.frames.length - 1) {
        renderFrameToCanvas(doc, cf + 1, onionCanvas);
        ctx.globalAlpha = 0.2;
        ctx.drawImage(onionCanvas, px, py, drawW, drawH);
      }
      ctx.globalAlpha = 1;
    }

    if (et !== null) {
      const tile = doc.tileset.tiles[et];
      if (tile) {
        renderBufferToCanvas(tile, frameCanvas);
        ctx.drawImage(frameCanvas, px, py, drawW, drawH);
      }
    } else {
      renderFrameToCanvas(doc, cf, frameCanvas);
      ctx.drawImage(frameCanvas, px, py, drawW, drawH);
    }

    if (state.showGrid && z >= 6) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < surfW; x++) {
        const sx = Math.round(px + x * z) + 0.5;
        ctx.moveTo(sx, py);
        ctx.lineTo(sx, py + drawH);
      }
      for (let y = 1; y < surfH; y++) {
        const sy = Math.round(py + y * z) + 0.5;
        ctx.moveTo(px, sy);
        ctx.lineTo(px + drawW, sy);
      }
      ctx.stroke();
    }

    const activeLayer = doc.layers.find((l) => l.id === state.activeLayerId);
    if (et === null && activeLayer?.type === 'tilemap' && z >= 2) {
      const ts = doc.tileset.tileSize;
      ctx.strokeStyle = 'rgba(80, 170, 255, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = ts; x < surfW; x += ts) {
        const sx = Math.round(px + x * z) + 0.5;
        ctx.moveTo(sx, py);
        ctx.lineTo(sx, py + drawH);
      }
      for (let y = ts; y < surfH; y += ts) {
        const sy = Math.round(py + y * z) + 0.5;
        ctx.moveTo(px, sy);
        ctx.lineTo(px + drawW, sy);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, drawW - 1, drawH - 1);

    const sel = state.selection;
    if (sel && sel.w > 0 && sel.h > 0) {
      const sx = px + sel.x * z;
      const sy = py + sel.y * z;
      const sw = sel.w * z;
      const sh = sel.h * z;
      ctx.save();
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.lineDashOffset = 5;
      ctx.strokeStyle = '#000000';
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.restore();
    }
  }, []);

  const controllerRef = useRef<PaintController | null>(null);

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const state = useEditorStore.getState();
    return {
      x: Math.floor((clientX - rect.left - state.panX) / state.zoom),
      y: Math.floor((clientY - rect.top - state.panY) / state.zoom),
    };
  }, []);

  useEffect(() => {
    controllerRef.current = new PaintController(render);
    return () => {
      controllerRef.current?.cancel();
      controllerRef.current = null;
    };
  }, [render]);

  useEffect(() => {
    render();
  }, [
    render,
    zoom,
    panX,
    panY,
    docRev,
    currentFrame,
    onionSkin,
    showGrid,
    selection,
    editingTile,
    tool,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => render());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [render]);

  // Zoom à la molette, centré sur le pointeur (listener natif non passif).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const state = useEditorStore.getState();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const nextZoom = clamp(state.zoom * factor, 0.5, 64);
      const k = nextZoom / state.zoom;
      useEditorStore.getState().setUi({
        zoom: nextZoom,
        panX: mx - (mx - state.panX) * k,
        panY: my - (my - state.panY) * k,
      });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // Espace : déplacement temporaire · Suppr : effacer · Échap : annuler.
  useEffect(() => {
    const isTextField = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      return (
        !!el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      );
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextField(e.target)) return;
      if (e.code === 'Space') {
        spaceRef.current = true;
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        controllerRef.current?.cancel();
        useEditorStore.getState().setUi({ selection: null });
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        controllerRef.current?.clearSelection();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Ajuster la vue (événement envoyé par la barre d'état).
  useEffect(() => {
    const onFit = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const state = useEditorStore.getState();
      const rect = canvas.getBoundingClientRect();
      const surfW =
        state.editingTile !== null
          ? state.doc.tileset.tileSize
          : state.doc.width;
      const surfH =
        state.editingTile !== null
          ? state.doc.tileset.tileSize
          : state.doc.height;
      const z = clamp(
        Math.min((rect.width - 48) / surfW, (rect.height - 48) / surfH),
        0.5,
        64,
      );
      useEditorStore.getState().setUi({
        zoom: z,
        panX: (rect.width - surfW * z) / 2,
        panY: (rect.height - surfH * z) / 2,
      });
    };
    window.addEventListener('pixelforge-fit', onFit);
    return () => window.removeEventListener('pixelforge-fit', onFit);
  }, []);

  return (
    <div className="canvas-wrap">
      <canvas
        ref={canvasRef}
        data-tool={tool}
        onPointerDown={(e) => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          canvas.setPointerCapture(e.pointerId);
          const state = useEditorStore.getState();
          if (e.button === 1 || state.tool === 'pan' || spaceRef.current) {
            panRef.current = {
              x: e.clientX,
              y: e.clientY,
              panX: state.panX,
              panY: state.panY,
            };
            return;
          }
          const p = toWorld(e.clientX, e.clientY);
          if (state.tool === 'select') {
            selectRef.current = p;
            useEditorStore
              .getState()
              .setUi({ selection: { x: p.x, y: p.y, w: 0, h: 0 } });
            return;
          }
          if (e.button === 0 || e.button === 2) {
            controllerRef.current?.pointerDown(p, e.button === 2);
          }
        }}
        onPointerMove={(e) => {
          const p = toWorld(e.clientX, e.clientY);
          useEditorStore.getState().setUi({ cursorX: p.x, cursorY: p.y });
          if (panRef.current) {
            const ps = panRef.current;
            useEditorStore.getState().setUi({
              panX: ps.panX + (e.clientX - ps.x),
              panY: ps.panY + (e.clientY - ps.y),
            });
            return;
          }
          if (selectRef.current) {
            const s0 = selectRef.current;
            const rect: Rect = {
              x: Math.min(s0.x, p.x),
              y: Math.min(s0.y, p.y),
              w: Math.abs(p.x - s0.x),
              h: Math.abs(p.y - s0.y),
            };
            useEditorStore.getState().setUi({ selection: rect });
            return;
          }
          controllerRef.current?.pointerMove(p, e.shiftKey);
        }}
        onPointerUp={(e) => {
          panRef.current = null;
          selectRef.current = null;
          controllerRef.current?.pointerUp(
            toWorld(e.clientX, e.clientY),
            e.shiftKey,
          );
        }}
        onPointerCancel={() => {
          panRef.current = null;
          selectRef.current = null;
          controllerRef.current?.cancel();
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      {editingTile !== null && (
        <div className="tile-edit-banner">
          Édition de la tile #{editingTile + 1} — cliquez sur « Terminer » pour
          revenir au document
        </div>
      )}
    </div>
  );
}
