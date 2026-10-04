/** Tampon de pixels RGBA (4 octets par pixel, ordre R,G,B,A). */
export interface PixelBuffer {
  width: number;
  height: number;
  /** Données RGBA ; le tampon sous-jacent est un ArrayBuffer (requis par ImageData). */
  data: Uint8ClampedArray<ArrayBuffer>;
}

/** Calque raster classique : un tampon de pixels par image (frame). */
export interface RasterLayer {
  id: string;
  type: 'raster';
  name: string;
  visible: boolean;
  /** Opacité du calque entre 0 et 1. */
  opacity: number;
  locked: boolean;
  /** Un tampon par image de l'animation (créé paresseusement). */
  frames: (PixelBuffer | null)[];
}

/** Contenu d'un calque de tilemap pour une image donnée. */
export interface TilemapFrame {
  cols: number;
  rows: number;
  /** Index de tile par cellule, -1 pour une cellule vide. */
  cells: Int32Array;
}

/** Calque de tilemap : chaque cellule référence une tile du tileset. */
export interface TilemapLayer {
  id: string;
  type: 'tilemap';
  name: string;
  visible: boolean;
  opacity: number;
  locked: boolean;
  frames: (TilemapFrame | null)[];
}

export type Layer = RasterLayer | TilemapLayer;

export interface FrameInfo {
  id: string;
  /** Durée d'affichage de l'image en millisecondes. */
  durationMs: number;
}

export interface Tileset {
  tileSize: number;
  tiles: PixelBuffer[];
}

export interface Doc {
  name: string;
  width: number;
  height: number;
  frames: FrameInfo[];
  /** Ordre de rendu : index 0 = calque du bas. */
  layers: Layer[];
  tileset: Tileset;
  palette: string[];
}

export type ToolId =
  | 'pencil'
  | 'eraser'
  | 'fill'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'eyedropper'
  | 'select'
  | 'pan';

/** Surface sur laquelle peint l'utilisateur : un calque/image ou une tile. */
export type PaintTarget =
  | { kind: 'layer'; layerId: string; frameIndex: number }
  | { kind: 'tile'; tileIndex: number };

export type HistoryPatch =
  | {
      kind: 'raster';
      target: PaintTarget;
      before: Uint8ClampedArray;
      after: Uint8ClampedArray;
    }
  | {
      kind: 'tilemap';
      layerId: string;
      frameIndex: number;
      before: Int32Array;
      after: Int32Array;
    }
  | { kind: 'doc'; before: Doc; after: Doc };

export interface HistoryEntry {
  label: string;
  patches: HistoryPatch[];
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
