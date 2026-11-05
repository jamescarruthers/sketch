// How values read on screen. Dimensions store mm and radians; these convert for display only.
import type { Design, Dimension } from '../model/types';
import { expressionDeps } from '../model/expressions';

const PER_UNIT: Record<Design['units'], number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

export function formatLength(mm: number, units: Design['units']): string {
  return (mm / PER_UNIT[units]).toFixed(units === 'mm' || units === 'cm' ? 2 : 3);
}

export function formatAngle(radians: number): string {
  return `${((radians * 180) / Math.PI).toFixed(1)} deg`;
}

/** Plain text for a HUD field or editor, in design units. */
export function formatValue(value: number, kind: 'length' | 'angle' | 'number', units: Design['units']): string {
  if (kind === 'angle') return formatAngle(value);
  if (kind === 'number') return String(Number(value.toFixed(4)));
  return `${formatLength(value, units)} ${units}`;
}

/** The status bar's time to solve: one decimal under 100 ms, whole milliseconds from there. */
export function formatSolveTime(ms: number): string {
  const body = ms < 0.05 ? '<0.1' : ms < 99.95 ? ms.toFixed(1) : String(Math.round(ms));
  return `Solve ${body} ms`;
}

/** A file size: whole bytes under 1 KB, then one decimal of KB or MB. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Canvas label: driven in parentheses [ref], fx: for an expression. */
export function dimensionText(design: Design, d: Dimension): string {
  const body = d.kind === 'angle' ? `${((d.value * 180) / Math.PI).toFixed(1)}°` : formatLength(d.value, design.units);
  const prefix = d.kind === 'radius' ? 'R' : d.kind === 'diameter' ? 'Ø' : '';
  if (!d.driving) return `(${prefix}${body})`;
  return `${expressionDeps(d.expression).length ? 'fx: ' : ''}${prefix}${body}`;
}
