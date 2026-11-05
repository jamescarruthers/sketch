// Every icon the app uses, as inline SVG drawn here. Colours follow the sketch: blue geometry, grey
// construction marks, red constraints. Tool icons are keyed by tool id.

// Colours are custom properties of src/ui/tokens.css, so an icon follows the theme with no redraw.
const BLUE = 'var(--ic-blue)';
const RED = 'var(--ic-red)';
const INK = 'var(--ic-ink)';
const ORANGE = 'var(--ic-orange)';
const GREEN = 'var(--ic-green)';
const WHITE = 'var(--ic-white)';
const HOLE = 'var(--ic-hole)';
const MUTED = 'var(--ic-muted)';
const PURPLE = 'var(--purple)';

const svg = (body: string, size = 24): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const path = (d: string, color = INK, width = 1.5): string => `<path d="${d}" stroke="${color}" stroke-width="${width}"/>`;
const blue = (d: string): string => path(d, BLUE, 1.6);
const red = (d: string): string => path(d, RED, 1.7);
const ink = (d: string): string => path(d, INK, 1.5);
const faint = (d: string): string => `<path d="${d}" stroke="${INK}" stroke-width="1.1" stroke-dasharray="2.5 2.2"/>`;
const node = (x: number, y: number, color = BLUE): string => `<rect x="${x - 1.6}" y="${y - 1.6}" width="3.2" height="3.2" fill="${color}"/>`;
const dot = (x: number, y: number, color = BLUE, r = 1.8): string => `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`;
const circle = (x: number, y: number, r: number, color = BLUE, width = 1.6): string =>
  `<circle cx="${x}" cy="${y}" r="${r}" stroke="${color}" stroke-width="${width}"/>`;
const poly = (points: string, color = BLUE): string => `<polygon points="${points}" stroke="${color}" stroke-width="1.6"/>`;
const label = (x: number, y: number, text: string, color = INK): string =>
  `<text x="${x}" y="${y}" font-size="8" font-family="Inter, sans-serif" font-weight="600" fill="${color}">${text}</text>`;

const corners = (color: string): string => [[5, 6], [16, 6], [16, 18], [5, 18]].map(([x, y]) => node(x, y, color)).join('');

const hexagon = (r: number): string => {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    pts.push(`${(12 + r * Math.cos(a)).toFixed(1)},${(12 + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
};

const ICONS: Record<string, string> = {
  // Create
  line: blue('M5 18 L19 6') + node(5, 18) + node(19, 6),
  'midpoint-line': blue('M4 18 L20 6') + node(4, 18) + node(20, 6) + poly('12,9.2 14.6,14 9.4,14', RED),
  'rect-2pt': blue('M4 7h16v11H4z') + node(4, 18) + node(20, 7),
  'rect-3pt': blue('M4 15 L14 4 L20 9.5 L10 20.5z') + node(4, 15) + node(14, 4) + node(20, 9.5),
  'rect-center': blue('M4 6h16v12H4z') + faint('M4 6 L20 18 M20 6 L4 18') + node(12, 12) + node(20, 18),
  'circle-center': circle(12, 12, 8) + faint('M12 12 L17.6 6.4') + node(12, 12) + node(17.6, 6.4),
  'circle-2pt': circle(12, 12, 8) + faint('M4 12 H20') + node(4, 12) + node(20, 12),
  'circle-3pt': circle(12, 12, 8) + node(4.5, 9.5) + node(17.6, 6.4) + node(12, 20),
  'circle-2tan': circle(12, 13, 6.5) + ink('M3 6.5 H21 M3.5 21 L10 3'),
  'circle-3tan': circle(12, 12.5, 5.5) + ink('M3 7 H21 M3.4 20 L12 3 M20.6 20 L12 3'),
  'arc-3pt': blue('M4 18 A10 10 0 0 1 20 18') + node(4, 18) + node(12, 8.2) + node(20, 18),
  'arc-center': blue('M18.5 12 A6.5 6.5 0 0 0 7.4 7.4') + faint('M12 12 L18.5 12 M12 12 L7.4 7.4') + node(12, 12) + node(18.5, 12) + node(7.4, 7.4),
  'arc-tangent': ink('M3 18 H11') + blue('M11 18 A7 7 0 0 0 18 11') + node(11, 18) + node(18, 11),
  'polygon-circumscribed': poly(hexagon(7)) + circle(12, 12, 8.5, INK, 1),
  'polygon-inscribed': circle(12, 12, 6.5, INK, 1) + poly(hexagon(8.2)),
  'polygon-edge': poly(hexagon(8)) + node(4.9, 16) + node(12, 20),
  ellipse: `<ellipse cx="12" cy="12" rx="9" ry="5.5" stroke="${BLUE}" stroke-width="1.6"/>` + faint('M3 12 H21 M12 6.5 V17.5') + node(12, 12),
  'slot-c2c': blue('M8 7.5 H16 A4.5 4.5 0 0 1 16 16.5 H8 A4.5 4.5 0 0 1 8 7.5') + faint('M8 12 H16') + node(8, 12) + node(16, 12),
  'slot-overall': blue('M8 7.5 H16 A4.5 4.5 0 0 1 16 16.5 H8 A4.5 4.5 0 0 1 8 7.5') + node(3.5, 12) + node(20.5, 12),
  'slot-center': blue('M8 7.5 H16 A4.5 4.5 0 0 1 16 16.5 H8 A4.5 4.5 0 0 1 8 7.5') + node(12, 12) + node(16, 12),
  'slot-3pt-arc': blue('M3.5 17 A10 10 0 0 1 20.5 17 L16.8 19 A6 6 0 0 0 7.2 19 Z') + node(5.4, 18) + node(12, 9.8) + node(18.6, 18),
  'slot-center-arc': blue('M3.5 17 A10 10 0 0 1 20.5 17 L16.8 19 A6 6 0 0 0 7.2 19 Z') + faint('M12 21 L5.4 18') + node(12, 21) + node(5.4, 18),
  'spline-fit': blue('M4 17 C8 3 13 21 20 6') + node(4, 17) + node(9.6, 11.2) + node(14.4, 13) + node(20, 6),
  'spline-control': blue('M4 18 C9 2 15 22 20 6') + faint('M4 18 L9 5 L15 19 L20 6') + node(4, 18) + node(9, 5) + node(15, 19) + node(20, 6),
  conic: blue('M4 19 C6 8 12 5 20 5') + faint('M4 19 L4 5 L20 5') + node(4, 19) + node(4, 5) + node(20, 5),
  point: dot(12, 12, BLUE, 2.6) + faint('M12 4 V9 M12 15 V20 M4 12 H9 M15 12 H20'),
  text: ink('M6 6 H18 M12 6 V19 M9.5 19 H14.5'),
  mirror: poly('3.5,19 10,19 10,6', BLUE) + poly('20.5,19 14,19 14,6', INK) + path('M12 3 V21', RED, 1.4),
  'pattern-rect': blue('M4 4h5v5H4z M15 4h5v5h-5z M4 15h5v5H4z M15 15h5v5h-5z'),
  'pattern-circ': circle(12, 4.5, 2.4) + circle(19.5, 12, 2.4) + circle(12, 19.5, 2.4) + circle(4.5, 12, 2.4) + dot(12, 12, INK, 1.4),
  project: path('M4 6h11v8H4z', INK, 1.3) + path('M8 10h11v8H8z', PURPLE, 1.6) + faint('M4 6 L8 10 M15 14 L19 18'),
  intersect: ink('M4 7 L14 3 L20 11 L10 15z') + path('M4 19 L20 5', PURPLE, 1.6),
  'include-3d': ink('M12 3 L20 7.5 V16.5 L12 21 L4 16.5 V7.5z M12 12 L20 7.5 M12 12 V21 M12 12 L4 7.5'),
  'project-surface': ink('M3 16 C8 11 15 21 21 15') + faint('M7 5 V13 M12 5 V15 M17 5 V15') + blue('M5 5 H19'),
  'intersection-curve': ink('M3 8 C9 4 15 12 21 8') + blue('M6 19 C9 12 14 12 18 5'),
  'spun-profile': ink('M12 3 V21') + blue('M12 4 C21 7 17 13 20 20 M12 4 C3 7 7 13 4 20'),
  'isoparametric-curve': ink('M4 18 C8 6 16 6 20 18 M4 18 C9 13 15 13 20 18') + blue('M12 8 V15'),
  'fit-curves-mesh': ink('M3 8 L9 4 L15 8 L21 4 M3 8 L9 12 L15 8 L21 12 M9 4 V12 M15 8 V16') + blue('M3 20 C9 14 15 22 21 16'),
  dimension: ink('M4 5 V19 M20 5 V19') + path('M4 12 H20', ORANGE, 1.6) + path('M7 9.5 L4 12 L7 14.5 M17 9.5 L20 12 L17 14.5', ORANGE, 1.4),

  // Modify
  fillet: ink('M4 20 V12') + blue('M4 12 A8 8 0 0 1 12 4') + ink('M12 4 H20') + faint('M4 12 V4 H12'),
  'chamfer-equal': ink('M4 20 V10 M10 4 H20') + blue('M4 10 L10 4') + label(13, 16, '=', BLUE),
  'chamfer-distance-angle': ink('M4 20 V10 M10 4 H20') + blue('M4 10 L10 4') + path('M6.8 13 A5 5 0 0 0 10 9.4', RED, 1.2),
  'chamfer-two-distance': ink('M4 20 V14 M8 4 H20') + blue('M4 14 L8 4') + node(4, 14) + node(8, 4),
  trim: ink('M4 12 H9') + faint('M9 12 H17') + ink('M12 4 V20') + red('M15 8 L20 16 M20 8 L15 16'),
  extend: blue('M3 12 H13') + faint('M13 12 H20') + ink('M20 4 V20') + path('M14 9 L17 12 L14 15', RED, 1.4),
  break: blue('M3 12 H10.5 M13.5 12 H21') + red('M10 7 L12 11 L12 13 L14 17'),
  offset: blue('M5 20 V10 A6 6 0 0 1 11 4 H20') + ink('M9 20 V10.5 A2.5 2.5 0 0 1 11.5 8 H20'),
  'blend-curve': blue('M3 6 H9') + ink('M9 6 C15 6 10 18 16 18') + blue('M16 18 H21'),
  scale: ink('M4 20 H14 V10 H4z') + blue('M4 20 V4 H20 V20 H14') + path('M14 10 L20 4', RED, 1.4),
  'move-copy': ink('M12 3 V21 M3 12 H21') + path('M9.5 5.5 L12 3 L14.5 5.5 M9.5 18.5 L12 21 L14.5 18.5 M5.5 9.5 L3 12 L5.5 14.5 M18.5 9.5 L21 12 L18.5 14.5', BLUE, 1.5),
  'change-parameters': ink('M4 6 H20 M4 12 H20 M4 18 H20') + label(6, 10.6, 'fx', BLUE),

  // Constraints
  autoconstrain: blue('M5 19 L19 5') + red('M14 19 L19 19 L19 14') + dot(5, 19) + dot(19, 5) + path('M4 6 L6 4 M4 4 L6 6 M18 16 L18 16', RED, 1.2),
  'autoconstrain-datum': blue('M5 19 L19 5') + red('M14 19 L19 19 L19 14') + circle(5, 19, 2.6, RED, 1.5) + dot(19, 5),
  hv: red('M9 3.5 V20.5') + ink('M4 20.5 H20'),
  coincident: red('M3 18 H21') + circle(12, 11.5, 4, RED, 1.7),
  tangent: red('M3 7 H21') + circle(12, 14, 6.5, RED, 1.7),
  equal: red('M5 9 H19 M5 15 H19'),
  parallel: red('M4 20 L15 4 M9 20 L20 4'),
  perpendicular: red('M4 20 H20 M12 20 V4'),
  fix: `<rect x="5" y="11" width="14" height="10" rx="1" fill="${RED}" fill-opacity=".85"/>` + path('M8 11 V7.5 A4 4 0 0 1 16 7.5 V11', RED, 1.8),
  midpoint: poly('12,5 20,19 4,19', RED),
  concentric: circle(12, 12, 8.5, RED, 1.7) + circle(12, 12, 4.5, RED, 1.7),
  collinear: red('M3 21 L21 3') + dot(9, 15, RED, 2) + dot(15, 9, RED, 2),
  symmetry: red('M12 3 V21') + ink('M4 8 H9 M4 16 H9 M15 8 H20 M15 16 H20 M4 8 V16 M20 8 V16'),
  curvature: red('M3 20 C10 20 7 12 12 12') + ink('M12 12 C17 12 14 4 21 4'),

  // Select and app
  select: `<rect x="3.5" y="3.5" width="14" height="14" stroke="${BLUE}" stroke-width="1.4" stroke-dasharray="2.5 2"/>` + `<path d="M11 10 L20 14 L16 15.5 L18.8 20 L16.8 21 L14 16.6 L11 19.5z" fill="${BLUE}"/>`,
  'create-sketch': blue('M4 6h13v12H4z') + path('M14 14 L21 7 L19 5 L12 12 L11.5 14.5z', ORANGE, 1.4),
  'finish-sketch': `<circle cx="12" cy="12" r="10" fill="${GREEN}"/><path d="M7 12.5 L10.5 16 L17 8.5" stroke="${WHITE}" stroke-width="2.4"/>`,
  undo: ink('M5 9 H15 A5 5 0 0 1 15 19 H8 M5 9 L9 5 M5 9 L9 13'),
  redo: ink('M19 9 H9 A5 5 0 0 0 9 19 H16 M19 9 L15 5 M19 9 L15 13'),
  check: `<circle cx="12" cy="12" r="10" fill="${GREEN}"/><path d="M7 12.5 L10.5 16 L17 8.5" stroke="${WHITE}" stroke-width="2.4"/>`,
  close: ink('M7 7 L17 17 M17 7 L7 17'),
  tick: ink('M5 12.5 L10 17 L19 7'),
  minus: ink('M6 12 H18'),
  delete: ink('M5 7 H19 M9 7 V4.5 H15 V7 M7 7 L8 20 H16 L17 7 M10.5 10.5 V16.5 M13.5 10.5 V16.5'),
  construction: path('M4 20 L20 4', ORANGE, 1.6) + `<circle cx="12" cy="12" r="3.6" fill="${HOLE}" stroke="${ORANGE}" stroke-width="1.3"/>` + path('M4 12 H8 M16 12 H20', ORANGE, 1.1),
  centerline: `<path d="M3 20 L21 4" stroke="${ORANGE}" stroke-width="1.6" stroke-dasharray="7 2.5 1.5 2.5"/>`,
  'look-at': ink('M4 8 H20 V19 H4z M4 8 L7 4 H17 L20 8') + blue('M9 13.5 H15 M12 11 V16'),
  eye: ink('M2.5 12 C6 6.5 18 6.5 21.5 12 C18 17.5 6 17.5 2.5 12z') + `<circle cx="12" cy="12" r="2.6" stroke="${INK}" stroke-width="1.5"/>`,
  'eye-off': ink('M2.5 12 C6 6.5 18 6.5 21.5 12 C18 17.5 6 17.5 2.5 12z M4 4 L20 20'),
  lock: `<rect x="6" y="11" width="12" height="9" rx="1" stroke="${INK}" stroke-width="1.5" fill="${INK}" fill-opacity=".2"/>` + ink('M8.5 11 V8 A3.5 3.5 0 0 1 15.5 8 V11'),
  'lock-open': `<rect x="6" y="11" width="12" height="9" rx="1" stroke="${INK}" stroke-width="1.5"/>` + ink('M8.5 11 V8 A3.5 3.5 0 0 1 15.3 6.8'),
  plus: ink('M12 6 V18 M6 12 H18'),
  document: ink('M6 3 H14 L18 7 V21 H6z M14 3 V7 H18'),
  origin: `<circle cx="12" cy="12" r="7" stroke="${INK}" stroke-width="1.5"/><path d="M12 12 V5 A7 7 0 0 1 19 12z M12 12 V19 A7 7 0 0 1 5 12z" fill="${INK}"/>`,
  folder: ink('M3 7 H10 L12 9.5 H21 V19 H3z'),
  // Dashed outline, corner squares and a pencil; grey with a red lock once constrained [ref SKT-3D-SKETCH].
  'sketch-node': `<path d="M5 6h11v12H5z" fill="none" stroke="${BLUE}" stroke-width="1.2" stroke-dasharray="2.5 2"/>` + corners(BLUE) + path('M14 14 L21 7', ORANGE, 1.4),
  'sketch-locked': `<path d="M5 6h11v12H5z" fill="none" stroke="${MUTED}" stroke-width="1.2" stroke-dasharray="2.5 2"/>` + corners(MUTED) + `<rect x="12" y="12.5" width="9" height="7.5" rx="1" fill="${RED}"/>` + path('M14 12.5 V10 A2.5 2.5 0 0 1 19 10 V12.5', RED, 1.5),
  home: ink('M4 12 L12 5 L20 12 M7 10.5 V19 H17 V10.5'),
  // A box with a path round it: the Orbit view.
  orbit: ink('M8 9.5 L12 7.5 L16 9.5 V14 L12 16 L8 14z M8 9.5 L12 11.5 L16 9.5 M12 11.5 V16') + ink('M5.5 16.5 A8.5 4.5 -20 0 1 17.5 6 M15.3 5.2 L17.5 6 L16.9 8.3'),
  caret: `<path d="M7 9.5 L12 15 L17 9.5z" fill="currentColor"/>`,
  chevron: `<path d="M9.5 7 L15 12 L9.5 17z" fill="currentColor"/>`,
  copy: ink('M9 9 H20 V20 H9z M15 9 V4 H4 V15 H9'),
  paste: ink('M6 5 H18 V21 H6z M9 3 H15 V7 H9z'),
  'curvature-comb': blue('M3 18 C9 6 15 6 21 18') + faint('M6 13 L5 8 M10 9.5 L9.6 5 M14 9.5 L14.4 5 M18 13 L19 8'),
  'spline-degree': blue('M4 18 C9 2 15 22 20 6') + label(13, 22, 'n', INK),
  measure: ink('M3 16 L16 3 L21 8 L8 21 Z') + faint('M7 12 L9.5 14.5 M10 9 L12.5 11.5 M13 6 L15.5 8.5') + node(4.5, 14.5) + node(19.5, 9.5),
  'find-under': circle(11, 11, 6, INK, 1.6) + ink('M15.5 15.5 L21 21') + blue('M8 13 L14 9'),
};

/** Inline SVG for an icon name; an unknown name draws a plain outline, so a missing icon is visible. */
export function icon(name: string, size?: number): string {
  const small = name === 'caret' || name === 'chevron' ? 11 : undefined;
  return svg(ICONS[name] ?? ink('M5 5h14v14H5z'), size ?? small ?? 24);
}

export const iconNames = (): string[] => Object.keys(ICONS);
