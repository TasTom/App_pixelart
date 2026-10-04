import { create } from 'zustand';
import type {
  Doc,
  HistoryEntry,
  Layer,
  PixelBuffer,
  Rect,
  ToolId,
} from '../types';
import {
  addBlankFrameToLayers,
  cloneDoc,
  createDoc,
  createRasterLayer,
  createTilemapLayer,
  DEFAULT_TILE_SIZE,
  duplicateFrameInLayers,
  padLayerFrames,
  removeFrameFromLayers,
  resizeDoc,
  uid,
} from '../core/document';
import {
  applyEntry,
  docPatch,
  HISTORY_LIMIT,
} from '../core/history';
import { blitBuffer, createPixelBuffer, clonePixelBuffer } from '../utils/pixels';

export interface EditorUi {
  tool: ToolId;
  primaryColor: string;
  secondaryColor: string;
  brushSize: number;
  shapeFilled: boolean;
  zoom: number;
  panX: number;
  panY: number;
  currentFrame: number;
  activeLayerId: string;
  selectedTile: number;
  editingTile: number | null;
  onionSkin: boolean;
  playing: boolean;
  showGrid: boolean;
  cursorX: number;
  cursorY: number;
  selection: Rect | null;
  newDialogOpen: boolean;
}

export interface EditorState extends EditorUi {
  doc: Doc;
  /** Incrémenté à chaque modification du document (rafraîchit les miniatures). */
  docRev: number;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];

  setUi: (patch: Partial<EditorUi>) => void;
  newDoc: (name: string, width: number, height: number, tileSize?: number) => void;
  loadDoc: (doc: Doc) => void;
  commitHistory: (entry: HistoryEntry) => void;
  undo: () => void;
  redo: () => void;

  addLayer: (type: 'raster' | 'tilemap') => void;
  removeLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  moveLayer: (id: string, dir: -1 | 1) => void;
  setLayerOpacity: (id: string, opacity: number) => void;
  toggleLayerVisible: (id: string) => void;
  toggleLayerLocked: (id: string) => void;
  renameLayer: (id: string, name: string) => void;

  addFrame: (duplicate: boolean) => void;
  deleteFrame: (index: number) => void;
  moveFrame: (index: number, dir: -1 | 1) => void;
  setFrameDuration: (index: number, ms: number) => void;
  setCurrentFrame: (index: number) => void;

  addTile: () => void;
  duplicateTile: (index: number) => void;
  deleteTile: (index: number) => void;

  resize: (width: number, height: number) => void;
  setPalette: (colors: string[]) => void;
  setDocName: (name: string) => void;

  /** Crée un nouveau document à partir de sprites générés (1 par image). */
  newDocFromBuffers: (name: string, frames: PixelBuffer[], durationMs?: number) => void;
  /** Ajoute un sprite généré comme nouveau calque (centré). */
  addLayerFromBuffer: (buffer: PixelBuffer, name: string) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function initialUi(doc: Doc): EditorUi {
  return {
    tool: 'pencil',
    primaryColor: '#1a1c2c',
    secondaryColor: '#f4f4f4',
    brushSize: 1,
    shapeFilled: false,
    zoom: Math.max(1, Math.min(24, Math.round(560 / Math.max(doc.width, doc.height)))),
    panX: 40,
    panY: 40,
    currentFrame: 0,
    activeLayerId: doc.layers[doc.layers.length - 1].id,
    selectedTile: 0,
    editingTile: null,
    onionSkin: false,
    playing: false,
    showGrid: true,
    cursorX: -1,
    cursorY: -1,
    selection: null,
    newDialogOpen: false,
  };
}

/** Restreint les indices UI si le document a changé de structure. */
function clampUiToDoc(doc: Doc, state: EditorState): Partial<EditorUi> {
  const patch: Partial<EditorUi> = {};
  if (state.currentFrame >= doc.frames.length) {
    patch.currentFrame = Math.max(0, doc.frames.length - 1);
  }
  const frame = patch.currentFrame ?? state.currentFrame;
  if (frame >= doc.frames.length) patch.currentFrame = 0;

  const activeExists = doc.layers.some((l) => l.id === state.activeLayerId);
  if (!activeExists && doc.layers.length > 0) {
    patch.activeLayerId = doc.layers[doc.layers.length - 1].id;
  }
  if (state.selectedTile >= doc.tileset.tiles.length) {
    patch.selectedTile = Math.max(0, doc.tileset.tiles.length - 1);
  }
  if (
    state.editingTile !== null &&
    state.editingTile >= doc.tileset.tiles.length
  ) {
    patch.editingTile = null;
  }
  return patch;
}

export const useEditorStore = create<EditorState>()((set, get) => {
  const initialDoc = createDoc('Sans titre', 64, 64);

  /** Applique un document cloné + une entrée d'historique structurelle. */
  const commitStructural = (label: string, next: Doc, uiPatch: Partial<EditorUi> = {}) => {
    const state = get();
    const entry: HistoryEntry = {
      label,
      patches: [docPatch(cloneDoc(state.doc), cloneDoc(next))],
    };
    set({
      doc: next,
      docRev: state.docRev + 1,
      undoStack: [...state.undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: [],
      ...clampUiToDoc(next, state),
      ...uiPatch,
    });
  };

  return {
    doc: initialDoc,
    docRev: 0,
    undoStack: [],
    redoStack: [],
    ...initialUi(initialDoc),

    setUi: (patch) => set(patch),

    newDoc: (name, width, height, tileSize = DEFAULT_TILE_SIZE) => {
      const doc = createDoc(
        name.trim() || 'Sans titre',
        clamp(Math.round(width), 1, 2048),
        clamp(Math.round(height), 1, 2048),
        tileSize,
      );
      set({
        doc,
        docRev: get().docRev + 1,
        undoStack: [],
        redoStack: [],
        ...initialUi(doc),
      });
    },

    loadDoc: (doc) => {
      set({
        doc,
        docRev: get().docRev + 1,
        undoStack: [],
        redoStack: [],
        ...initialUi(doc),
      });
    },

    commitHistory: (entry) => {
      const state = get();
      set({
        undoStack: [...state.undoStack, entry].slice(-HISTORY_LIMIT),
        redoStack: [],
        docRev: state.docRev + 1,
      });
    },

    undo: () => {
      const state = get();
      if (state.undoStack.length === 0) return;
      const entry = state.undoStack[state.undoStack.length - 1];
      const next = applyEntry(state.doc, entry, true);
      set({
        doc: next,
        docRev: state.docRev + 1,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, entry],
        ...clampUiToDoc(next, state),
      });
    },

    redo: () => {
      const state = get();
      if (state.redoStack.length === 0) return;
      const entry = state.redoStack[state.redoStack.length - 1];
      const next = applyEntry(state.doc, entry, false);
      set({
        doc: next,
        docRev: state.docRev + 1,
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [...state.undoStack, entry],
        ...clampUiToDoc(next, state),
      });
    },

    addLayer: (type) => {
      const state = get();
      const next = cloneDoc(state.doc);
      const count = next.layers.filter((l) => l.type === type).length + 1;
      const layer: Layer =
        type === 'raster'
          ? createRasterLayer(`Calque ${count}`)
          : createTilemapLayer(`Tilemap ${count}`);
      next.layers.push(layer);
      commitStructural(
        type === 'raster' ? 'Ajouter un calque' : 'Ajouter une tilemap',
        next,
        { activeLayerId: layer.id },
      );
    },

    removeLayer: (id) => {
      const state = get();
      if (state.doc.layers.length <= 1) return;
      const next = cloneDoc(state.doc);
      const index = next.layers.findIndex((l) => l.id === id);
      if (index < 0) return;
      next.layers.splice(index, 1);
      commitStructural('Supprimer un calque', next);
    },

    duplicateLayer: (id) => {
      const state = get();
      const next = cloneDoc(state.doc);
      const index = next.layers.findIndex((l) => l.id === id);
      if (index < 0) return;
      const source = next.layers[index];
      const copy: Layer =
        source.type === 'raster'
          ? {
              ...source,
              id: uid('layer'),
              name: `${source.name} (copie)`,
              frames: source.frames.map((b) => (b ? clonePixelBuffer(b) : null)),
            }
          : {
              ...source,
              id: uid('layer'),
              name: `${source.name} (copie)`,
              frames: source.frames.map((f) =>
                f
                  ? { cols: f.cols, rows: f.rows, cells: new Int32Array(f.cells) }
                  : null,
              ),
            };
      next.layers.splice(index + 1, 0, copy);
      commitStructural('Dupliquer un calque', next, { activeLayerId: copy.id });
    },

    moveLayer: (id, dir) => {
      const state = get();
      const next = cloneDoc(state.doc);
      const index = next.layers.findIndex((l) => l.id === id);
      const target = index + dir;
      if (index < 0 || target < 0 || target >= next.layers.length) return;
      const [layer] = next.layers.splice(index, 1);
      next.layers.splice(target, 0, layer);
      commitStructural('Déplacer un calque', next);
    },

    setLayerOpacity: (id, opacity) => {
      const state = get();
      const next = cloneDoc(state.doc);
      const layer = next.layers.find((l) => l.id === id);
      if (!layer) return;
      layer.opacity = clamp(opacity, 0, 1);
      commitStructural('Opacité du calque', next);
    },

    toggleLayerVisible: (id) => {
      const state = get();
      const next = cloneDoc(state.doc);
      const layer = next.layers.find((l) => l.id === id);
      if (!layer) return;
      layer.visible = !layer.visible;
      commitStructural('Visibilité du calque', next);
    },

    toggleLayerLocked: (id) => {
      const state = get();
      const next = cloneDoc(state.doc);
      const layer = next.layers.find((l) => l.id === id);
      if (!layer) return;
      layer.locked = !layer.locked;
      commitStructural('Verrouiller le calque', next);
    },

    renameLayer: (id, name) => {
      const state = get();
      const next = cloneDoc(state.doc);
      const layer = next.layers.find((l) => l.id === id);
      if (!layer) return;
      layer.name = name.trim() || layer.name;
      commitStructural('Renommer le calque', next);
    },

    addFrame: (duplicate) => {
      const state = get();
      const next = cloneDoc(state.doc);
      const currentIndex = clamp(state.currentFrame, 0, next.frames.length - 1);
      if (duplicate) {
        duplicateFrameInLayers(next, currentIndex);
        next.frames.splice(currentIndex + 1, 0, {
          id: uid('frame'),
          durationMs: next.frames[currentIndex].durationMs,
        });
        commitStructural('Dupliquer une image', next, {
          currentFrame: currentIndex + 1,
        });
      } else {
        addBlankFrameToLayers(next);
        next.frames.push({
          id: uid('frame'),
          durationMs: next.frames[currentIndex].durationMs,
        });
        commitStructural('Ajouter une image', next, {
          currentFrame: next.frames.length - 1,
        });
      }
    },

    deleteFrame: (index) => {
      const state = get();
      if (state.doc.frames.length <= 1) return;
      const next = cloneDoc(state.doc);
      if (index < 0 || index >= next.frames.length) return;
      removeFrameFromLayers(next, index);
      next.frames.splice(index, 1);
      commitStructural('Supprimer une image', next);
    },

    moveFrame: (index, dir) => {
      const state = get();
      const target = index + dir;
      if (
        index < 0 ||
        index >= state.doc.frames.length ||
        target < 0 ||
        target >= state.doc.frames.length
      ) {
        return;
      }
      const next = cloneDoc(state.doc);
      const [frame] = next.frames.splice(index, 1);
      next.frames.splice(target, 0, frame);
      for (const layer of next.layers) {
        padLayerFrames(layer, next.frames.length);
        if (layer.type === 'raster') {
          const [buf] = layer.frames.splice(index, 1);
          layer.frames.splice(target, 0, buf);
        } else {
          const [grid] = layer.frames.splice(index, 1);
          layer.frames.splice(target, 0, grid);
        }
      }
      commitStructural('Déplacer une image', next, { currentFrame: target });
    },

    setFrameDuration: (index, ms) => {
      const state = get();
      if (index < 0 || index >= state.doc.frames.length) return;
      const next = cloneDoc(state.doc);
      next.frames[index].durationMs = clamp(Math.round(ms), 20, 10000);
      commitStructural('Durée de l\'image', next);
    },

    setCurrentFrame: (index) => {
      const state = get();
      set({ currentFrame: clamp(index, 0, state.doc.frames.length - 1) });
    },

    addTile: () => {
      const state = get();
      const next = cloneDoc(state.doc);
      const ts = next.tileset.tileSize;
      next.tileset.tiles.push(createPixelBuffer(ts, ts));
      commitStructural('Ajouter une tile', next, {
        selectedTile: next.tileset.tiles.length - 1,
      });
    },

    duplicateTile: (index) => {
      const state = get();
      const next = cloneDoc(state.doc);
      const tile = next.tileset.tiles[index];
      if (!tile) return;
      next.tileset.tiles.push(clonePixelBuffer(tile));
      commitStructural('Dupliquer une tile', next, {
        selectedTile: next.tileset.tiles.length - 1,
      });
    },

    deleteTile: (index) => {
      const state = get();
      const next = cloneDoc(state.doc);
      if (next.tileset.tiles.length <= 1 || index < 0 || index >= next.tileset.tiles.length) {
        return;
      }
      next.tileset.tiles.splice(index, 1);
      for (const layer of next.layers) {
        if (layer.type !== 'tilemap') continue;
        for (const frame of layer.frames) {
          if (!frame) continue;
          for (let i = 0; i < frame.cells.length; i++) {
            const cell = frame.cells[i];
            if (cell === index) frame.cells[i] = -1;
            else if (cell > index) frame.cells[i] = cell - 1;
          }
        }
      }
      commitStructural('Supprimer une tile', next);
    },

    resize: (width, height) => {
      const state = get();
      const next = cloneDoc(state.doc);
      resizeDoc(
        next,
        clamp(Math.round(width), 1, 2048),
        clamp(Math.round(height), 1, 2048),
      );
      commitStructural('Redimensionner', next, { selection: null });
    },

    setPalette: (colors) => {
      const state = get();
      set({
        doc: { ...state.doc, palette: [...colors] },
        docRev: state.docRev + 1,
      });
    },

    setDocName: (name) => {
      const state = get();
      set({
        doc: { ...state.doc, name: name.trim() || state.doc.name },
        docRev: state.docRev + 1,
      });
    },

    newDocFromBuffers: (name, frames, durationMs = 140) => {
      const source = frames[0];
      if (!source) return;
      const doc = createDoc(
        name.trim() || 'Sprite généré',
        source.width,
        source.height,
      );
      doc.frames = frames.map(() => ({ id: uid('frame'), durationMs }));
      const layer = doc.layers[0];
      if (layer.type === 'raster') {
        layer.name = 'Sprite';
        frames.forEach((buf, i) => {
          layer.frames[i] = clonePixelBuffer(buf);
        });
      }
      set({
        doc,
        docRev: get().docRev + 1,
        undoStack: [],
        redoStack: [],
        ...initialUi(doc),
      });
    },

    addLayerFromBuffer: (buffer, name) => {
      const state = get();
      const next = cloneDoc(state.doc);
      const layer = createRasterLayer(name.trim() || 'Sprite généré');
      padLayerFrames(layer, next.frames.length);
      const target = createPixelBuffer(next.width, next.height);
      blitBuffer(
        buffer,
        target,
        Math.floor((next.width - buffer.width) / 2),
        Math.floor((next.height - buffer.height) / 2),
      );
      const frameIndex = clamp(state.currentFrame, 0, next.frames.length - 1);
      layer.frames[frameIndex] = target;
      next.layers.push(layer);
      commitStructural('Ajouter un sprite', next, { activeLayerId: layer.id });
    },
  };
});
