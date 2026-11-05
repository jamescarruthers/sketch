// Where every tool in docs/SPEC.md section 6 sits in the toolbar. A tool that is listed here but not
// in the registry shows greyed, so registering a tool with one of these ids needs no edit here.
import type { Panel } from './tool';

export type MenuEntry =
  | { id: string; label: string; shortcut?: string; unavailable?: string }
  | { flyout: string; icon: string; items: MenuEntry[] };

export interface MenuPanel {
  panel: Panel;
  label: string;
  /** Tools with an icon on the ribbon itself, left to right. */
  pinned: string[];
  entries: MenuEntry[];
}

const NEEDS_3D = 'Needs 3D geometry';

export const MENU: MenuPanel[] = [
  {
    panel: 'create',
    label: 'Create',
    pinned: ['line', 'rect-2pt', 'circle-center', 'spline-fit', 'mirror', 'dimension'],
    entries: [
      { id: 'line', label: 'Line', shortcut: 'L' },
      { id: 'midpoint-line', label: 'Midpoint Line' },
      {
        flyout: 'Rectangle', icon: 'rect-2pt', items: [
          { id: 'rect-2pt', label: '2-Point Rectangle', shortcut: 'R' },
          { id: 'rect-3pt', label: '3-Point Rectangle' },
          { id: 'rect-center', label: 'Center Rectangle' },
        ],
      },
      {
        flyout: 'Circle', icon: 'circle-center', items: [
          { id: 'circle-center', label: 'Center Diameter Circle', shortcut: 'C' },
          { id: 'circle-2pt', label: '2-Point Circle' },
          { id: 'circle-3pt', label: '3-Point Circle' },
          { id: 'circle-2tan', label: '2-Tangent Circle' },
          { id: 'circle-3tan', label: '3-Tangent Circle' },
        ],
      },
      {
        flyout: 'Arc', icon: 'arc-3pt', items: [
          { id: 'arc-3pt', label: '3-Point Arc' },
          { id: 'arc-center', label: 'Center Point Arc' },
          { id: 'arc-tangent', label: 'Tangent Arc' },
        ],
      },
      {
        flyout: 'Polygon', icon: 'polygon-circumscribed', items: [
          { id: 'polygon-circumscribed', label: 'Circumscribed Polygon' },
          { id: 'polygon-inscribed', label: 'Inscribed Polygon' },
          { id: 'polygon-edge', label: 'Edge Polygon' },
        ],
      },
      { id: 'ellipse', label: 'Ellipse' },
      {
        flyout: 'Slot', icon: 'slot-c2c', items: [
          { id: 'slot-c2c', label: 'Center To Center Slot' },
          { id: 'slot-overall', label: 'Overall Slot' },
          { id: 'slot-center', label: 'Center Point Slot' },
          { id: 'slot-3pt-arc', label: 'Three Point Arc Slot' },
          { id: 'slot-center-arc', label: 'Center Point Arc Slot' },
        ],
      },
      {
        flyout: 'Spline', icon: 'spline-fit', items: [
          { id: 'spline-fit', label: 'Fit Point Spline' },
          { id: 'spline-control', label: 'Control Point Spline' },
        ],
      },
      { id: 'conic', label: 'Conic Curve' },
      { id: 'point', label: 'Point' },
      { id: 'text', label: 'Text' },
      { id: 'mirror', label: 'Mirror' },
      { id: 'pattern-rect', label: 'Rectangular Pattern' },
      { id: 'pattern-circ', label: 'Circular Pattern' },
      {
        flyout: 'Project / Include', icon: 'project', items: [
          { id: 'project', label: 'Project', shortcut: 'P' },
          { id: 'intersect', label: 'Intersect', unavailable: NEEDS_3D },
          { id: 'include-3d', label: 'Include 3D Geometry', unavailable: NEEDS_3D },
          { id: 'project-surface', label: 'Project To Surface', unavailable: NEEDS_3D },
          { id: 'intersection-curve', label: 'Intersection Curve', unavailable: NEEDS_3D },
          { id: 'spun-profile', label: 'Spun Profile', unavailable: NEEDS_3D },
          { id: 'isoparametric-curve', label: 'Isoparametric Curve', unavailable: NEEDS_3D },
        ],
      },
      { id: 'fit-curves-mesh', label: 'Fit Curves To Mesh Section', unavailable: NEEDS_3D },
      { id: 'dimension', label: 'Sketch Dimension', shortcut: 'D' },
    ],
  },
  {
    panel: 'modify',
    label: 'Modify',
    pinned: ['fillet', 'trim', 'offset'],
    entries: [
      { id: 'fillet', label: 'Fillet' },
      {
        flyout: 'Chamfer', icon: 'chamfer-equal', items: [
          { id: 'chamfer-equal', label: 'Equal Distance Chamfer' },
          { id: 'chamfer-distance-angle', label: 'Distance And Angle Chamfer' },
          { id: 'chamfer-two-distance', label: 'Two Distance Chamfer' },
        ],
      },
      { id: 'trim', label: 'Trim', shortcut: 'T' },
      { id: 'extend', label: 'Extend' },
      { id: 'break', label: 'Break' },
      { id: 'scale', label: 'Sketch Scale' },
      { id: 'offset', label: 'Offset', shortcut: 'O' },
      { id: 'blend-curve', label: 'Blend Curve' },
      { id: 'move-copy', label: 'Move/Copy', shortcut: 'M' },
      { id: 'change-parameters', label: 'Change Parameters' },
    ],
  },
  {
    panel: 'constraints',
    label: 'Constraints',
    pinned: [
      'hv', 'coincident', 'tangent', 'equal', 'parallel', 'perpendicular', 'fix', 'midpoint', 'concentric',
      'collinear', 'symmetry', 'curvature',
    ],
    entries: [
      { id: 'autoconstrain', label: 'AutoConstrain' },
      { id: 'autoconstrain-datum', label: 'AutoConstrain From Datum' },
      { id: 'hv', label: 'Horizontal/Vertical' },
      { id: 'coincident', label: 'Coincident' },
      { id: 'tangent', label: 'Tangent' },
      { id: 'equal', label: 'Equal' },
      { id: 'parallel', label: 'Parallel' },
      { id: 'perpendicular', label: 'Perpendicular' },
      { id: 'fix', label: 'Fix/UnFix' },
      { id: 'midpoint', label: 'Midpoint' },
      { id: 'concentric', label: 'Concentric' },
      { id: 'collinear', label: 'Collinear' },
      { id: 'symmetry', label: 'Symmetry' },
      { id: 'curvature', label: 'Curvature' },
    ],
  },
  {
    panel: 'automate',
    label: 'Automate',
    pinned: ['autoconstrain'],
    entries: [
      { id: 'autoconstrain', label: 'AutoConstrain' },
      { id: 'autoconstrain-datum', label: 'AutoConstrain From Datum' },
    ],
  },
  {
    panel: 'inspect',
    label: 'Inspect',
    pinned: ['measure'],
    entries: [{ id: 'measure', label: 'Measure', shortcut: 'I' }],
  },
  {
    panel: 'select',
    label: 'Select',
    pinned: ['select'],
    entries: [{ id: 'select', label: 'Select' }],
  },
];

/** The dropdown under Finish Sketch. */
export const FINISH_ENTRIES: MenuEntry[] = [
  { id: 'finish-autoconstrain', label: 'Finish with AutoConstrain' },
];

/** Every entry, flattened, flyouts removed. */
export function allEntries(): Extract<MenuEntry, { id: string }>[] {
  const out: Extract<MenuEntry, { id: string }>[] = [];
  const walk = (e: MenuEntry): void => {
    if ('flyout' in e) e.items.forEach(walk);
    else out.push(e);
  };
  for (const p of MENU) p.entries.forEach(walk);
  FINISH_ENTRIES.forEach(walk);
  return out.filter((e, i) => out.findIndex((o) => o.id === e.id) === i);
}
