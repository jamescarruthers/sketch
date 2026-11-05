// Adaptive sketch grid and axes. Lines are snapped to device pixels so they stay one pixel wide.
import type { View } from '../app/view';
import { COLORS } from './style';

const SCALE_FONT = '10px Inter, system-ui, sans-serif';

function lines(g: CanvasRenderingContext2D, view: View, step: number, color: string, skip?: number): void {
  const { width, height, dpr } = view;
  const topLeft = view.toWorld({ x: 0, y: 0 });
  const bottomRight = view.toWorld({ x: width, y: height });
  const crisp = (v: number): number => (Math.round(v * dpr) + 0.5) / dpr;
  const onSkip = (i: number): boolean => skip !== undefined && Math.abs((i * step) / skip - Math.round((i * step) / skip)) < 1e-6;
  g.strokeStyle = color;
  g.lineWidth = 1 / dpr;
  g.setLineDash([]);
  g.beginPath();
  for (let i = Math.ceil(topLeft.x / step); i * step <= bottomRight.x; i++) {
    if (onSkip(i)) continue;
    const x = crisp(view.toScreen({ x: i * step, y: 0 }).x);
    g.moveTo(x, 0);
    g.lineTo(x, height);
  }
  for (let i = Math.ceil(bottomRight.y / step); i * step <= topLeft.y; i++) {
    if (onSkip(i)) continue;
    const y = crisp(view.toScreen({ x: 0, y: i * step }).y);
    g.moveTo(0, y);
    g.lineTo(width, y);
  }
  g.stroke();
}

export function drawGrid(g: CanvasRenderingContext2D, view: View): void {
  const { minor, major } = view.gridSteps();
  lines(g, view, minor, COLORS.gridMinor, major);
  lines(g, view, major, COLORS.gridMajor);
}

/** Sketch scale along the axes at every major grid line [ref tutorial images]. Sits on the axis, or on the window edge when the axis is off screen. */
function drawScale(g: CanvasRenderingContext2D, view: View): void {
  const { major } = view.gridSteps();
  const { width, height } = view;
  const o = view.toScreen({ x: 0, y: 0 });
  const topLeft = view.toWorld({ x: 0, y: 0 });
  const bottomRight = view.toWorld({ x: width, y: height });
  const text = (v: number): string => String(Number(v.toPrecision(6)));
  g.font = SCALE_FONT;
  g.fillStyle = COLORS.dimensionMuted;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  const y = Math.min(Math.max(o.y, 0), height - 16) + 3;
  for (let i = Math.ceil(topLeft.x / major); i * major <= bottomRight.x; i++) {
    if (i !== 0) g.fillText(text(i * major), view.toScreen({ x: i * major, y: 0 }).x, y);
  }
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  const x = Math.min(Math.max(o.x, 0), width - 40) + 4;
  for (let i = Math.ceil(bottomRight.y / major); i * major <= topLeft.y; i++) {
    if (i !== 0) g.fillText(text(i * major), x, view.toScreen({ x: 0, y: i * major }).y);
  }
}

export function drawAxes(g: CanvasRenderingContext2D, view: View): void {
  const o = view.toScreen({ x: 0, y: 0 });
  const crisp = (v: number): number => (Math.round(v * view.dpr) + 0.5) / view.dpr;
  const x = crisp(o.x);
  const y = crisp(o.y);
  g.setLineDash([]);
  g.lineWidth = 1 / view.dpr;
  g.strokeStyle = COLORS.axisY;
  g.beginPath();
  g.moveTo(x, 0);
  g.lineTo(x, view.height);
  g.stroke();
  g.strokeStyle = COLORS.axisX;
  g.beginPath();
  g.moveTo(0, y);
  g.lineTo(view.width, y);
  g.stroke();
  drawScale(g, view);
}
