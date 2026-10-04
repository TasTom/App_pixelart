import { describe, expect, it } from 'vitest';
import {
  applyBrush,
  constrainShape,
  drawEllipseOnBuffer,
  drawLineOnBuffer,
  drawRectOnBuffer,
  floodFillBuffer,
  floodFillCells,
  setCell,
} from '../drawOps';
import { createPixelBuffer, getPacked } from '../../utils/pixels';
import { packColor } from '../../utils/color';

const RED = packColor(255, 0, 0, 255);
const BLUE = packColor(0, 0, 255, 255);
const CLEAR = 0;

describe('applyBrush', () => {
  it('pose une brosse carrée centrée sur le pixel', () => {
    const buf = createPixelBuffer(8, 8);
    applyBrush(buf, 4, 4, 3, RED);
    expect(getPacked(buf, 4, 4)).toBe(RED);
    expect(getPacked(buf, 3, 3)).toBe(RED);
    expect(getPacked(buf, 5, 5)).toBe(RED);
    expect(getPacked(buf, 2, 2)).toBe(CLEAR);
    expect(getPacked(buf, 6, 6)).toBe(CLEAR);
  });

  it('découpe proprement aux bords', () => {
    const buf = createPixelBuffer(4, 4);
    applyBrush(buf, 0, 0, 3, RED);
    expect(getPacked(buf, 0, 0)).toBe(RED);
    expect(getPacked(buf, 1, 1)).toBe(RED);
    expect(getPacked(buf, 2, 2)).toBe(CLEAR);
  });
});

describe('drawLineOnBuffer', () => {
  it('trace une ligne horizontale continue', () => {
    const buf = createPixelBuffer(10, 10);
    drawLineOnBuffer(buf, 1, 5, 8, 5, 1, RED);
    for (let x = 1; x <= 8; x++) expect(getPacked(buf, x, 5)).toBe(RED);
    expect(getPacked(buf, 0, 5)).toBe(CLEAR);
    expect(getPacked(buf, 9, 5)).toBe(CLEAR);
  });

  it('trace une diagonale', () => {
    const buf = createPixelBuffer(10, 10);
    drawLineOnBuffer(buf, 0, 0, 4, 4, 1, RED);
    for (let i = 0; i <= 4; i++) expect(getPacked(buf, i, i)).toBe(RED);
  });
});

describe('drawRectOnBuffer / drawEllipseOnBuffer', () => {
  it('remplit un rectangle', () => {
    const buf = createPixelBuffer(10, 10);
    drawRectOnBuffer(buf, 2, 2, 5, 5, RED, true);
    expect(getPacked(buf, 2, 2)).toBe(RED);
    expect(getPacked(buf, 5, 5)).toBe(RED);
    expect(getPacked(buf, 1, 1)).toBe(CLEAR);
    expect(getPacked(buf, 6, 6)).toBe(CLEAR);
  });

  it('dessine un contour de rectangle', () => {
    const buf = createPixelBuffer(10, 10);
    drawRectOnBuffer(buf, 2, 2, 5, 5, RED, false);
    expect(getPacked(buf, 2, 2)).toBe(RED);
    expect(getPacked(buf, 5, 2)).toBe(RED);
    expect(getPacked(buf, 3, 3)).toBe(CLEAR);
  });

  it('remplit une ellipse dans sa boîte englobante', () => {
    const buf = createPixelBuffer(12, 12);
    drawEllipseOnBuffer(buf, 2, 2, 9, 9, RED, true);
    expect(getPacked(buf, 5, 5)).toBe(RED);
    expect(getPacked(buf, 2, 2)).toBe(CLEAR);
    expect(getPacked(buf, 11, 11)).toBe(CLEAR);
  });
});

describe('floodFillBuffer', () => {
  it('remplit une zone fermée par une barrière', () => {
    const buf = createPixelBuffer(6, 6);
    drawLineOnBuffer(buf, 3, 0, 3, 5, 1, RED);
    expect(floodFillBuffer(buf, 0, 0, BLUE)).toBe(true);
    expect(getPacked(buf, 0, 0)).toBe(BLUE);
    expect(getPacked(buf, 2, 5)).toBe(BLUE);
    expect(getPacked(buf, 4, 0)).toBe(CLEAR);
    expect(getPacked(buf, 3, 2)).toBe(RED);
  });

  it('ne fait rien si la couleur cible est identique', () => {
    const buf = createPixelBuffer(4, 4);
    expect(floodFillBuffer(buf, 0, 0, CLEAR)).toBe(false);
  });

  it('remplit tout un tampon vide', () => {
    const buf = createPixelBuffer(5, 5);
    floodFillBuffer(buf, 2, 2, RED);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) expect(getPacked(buf, x, y)).toBe(RED);
    }
  });
});

describe('tilemap', () => {
  it('setCell pose une valeur dans la grille', () => {
    const frame = { cols: 4, rows: 4, cells: new Int32Array(16).fill(-1) };
    expect(setCell(frame, 1, 1, 2)).toBe(true);
    expect(frame.cells[1 * 4 + 1]).toBe(2);
    expect(setCell(frame, 9, 9, 2)).toBe(false);
  });

  it('floodFillCells respecte les cellules occupées', () => {
    const frame = { cols: 4, rows: 4, cells: new Int32Array(16).fill(-1) };
    setCell(frame, 1, 1, 2);
    expect(floodFillCells(frame, 0, 0, 7)).toBe(true);
    expect(frame.cells[0]).toBe(7);
    expect(frame.cells[1 * 4 + 1]).toBe(2);
    expect(frame.cells[1 * 4 + 2]).toBe(7);
  });
});

describe('constrainShape', () => {
  it('contraint un carré', () => {
    const end = constrainShape('rect', { x: 0, y: 0 }, { x: 10, y: 4 });
    expect(end.x).toBe(10);
    expect(end.y).toBe(10);
  });

  it('contraint une ligne à 45°', () => {
    const end = constrainShape('line', { x: 0, y: 0 }, { x: 10, y: 8 });
    expect(Math.abs(end.x - end.y)).toBeLessThan(0.001);
    const flat = constrainShape('line', { x: 0, y: 0 }, { x: 10, y: 2 });
    expect(Math.abs(flat.y)).toBeLessThan(0.001);
  });
});
