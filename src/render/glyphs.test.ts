import { describe, expect, it } from 'vitest';
import { addConstraint, addLine, newDesign, newSketch } from '../model/document';
import { View } from '../app/view';
import { layoutBadges } from './glyphs';

describe('layoutBadges', () => {
  it('shows one glyph per type per curve, however many constraints share it [C-F29]', () => {
    const d = newDesign();
    const s = newSketch(d);
    const lines = [0, 1, 2, 3, 4, 5].map((i) => addLine(d, s, { x: 0, y: i * 10 }, { x: 40, y: i * 10 + 1 }));
    for (const l of lines.slice(1)) addConstraint(d, s, 'equal', [lines[0].id, l.id]);
    const view = new View();
    view.resize(800, 600, 1);
    const badges = layoutBadges(s, view);
    // Five on the other lines and one, not five, on the first.
    expect(badges).toHaveLength(6);
  });

  it('puts the circular pattern glyph at the centre of the pattern [C-F13]', () => {
    const d = newDesign();
    const s = newSketch(d);
    const l = addLine(d, s, { x: 30, y: 0 }, { x: 40, y: 0 });
    s.features.f1 = { id: 'f1', type: 'circPattern', sources: [l.id], center: 'origin', spacing: 'full', angle: 6.28, quantity: 3, suppressed: [], instances: {} };
    const view = new View();
    view.resize(800, 600, 1);
    const [b] = layoutBadges(s, view).filter((x) => x.feature);
    const o = view.toScreen({ x: 0, y: 0 });
    expect(Math.hypot(b.x - o.x, b.y - o.y)).toBeLessThan(20);
  });
});
