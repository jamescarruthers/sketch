import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Design, Sketch } from '../model/types';
import { DESIGN_VERSION } from '../model/types';
import { addCircle, addConstraint, addDimension, addFrameText, addLine, newDesign, newSketch } from '../model/document';
import { addLayer } from '../model/layers';
import { embedSentence, embedSummary, exportSvg } from './svg';
import { deserialize, serialize } from './project';
import {
  decodeSvgData, looksLikeSvg, SVG_DATA_FORMAT, SVG_DATA_NS, NO_SVG_DATA, type SvgData,
} from './svg-data';

// The reader proper takes its element from DOMParser, which Node does not have: the browser tests cover that.
// Here the element is found by pattern, and everything after it (format, length, checksum, decoding) is the real code.
const dataOf = (svg: string): SvgData => {
  const m = /<sketch:design ([^>]*)>([^<]*)<\/sketch:design>/.exec(svg);
  if (!m) throw new Error('no data element');
  const attrs = Object.fromEntries([...m[1].matchAll(/([\w:]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
  return { format: attrs.format, encoding: attrs.encoding, bytes: attrs.bytes, crc32: attrs.crc32, text: m[2] };
};

const demanding = (): { d: Design; s: Sketch } => {
  const d = newDesign('Größe 🙂 <&> "q" \'a\' ]]> end');
  const s = newSketch(d);
  const a = addLine(d, s, { x: 0, y: 0 }, { x: 40, y: 0 });
  addConstraint(d, s, 'horizontal', [a.id]);
  addDimension(d, s, 'distance', [a.a, a.b], 40, { label: { x: 20, y: 8 } });
  const up = addLayer(d);
  up.name = 'Größe 🙂 ]]> <&> "x"';
  addLine(d, s, { x: 0, y: 5 }, { x: 40, y: 5 });
  const gone = addLayer(d);
  gone.name = 'Hidden';
  addLine(d, s, { x: 0, y: 900 }, { x: 40, y: 900 });
  gone.visible = false;
  d.layers[1].locked = true;
  addFrameText(d, s, 'Größe 🙂 ]]> <&> "{x}"', 5, [{ x: 0, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 30 }, { x: 0, y: 30 }]);
  d.parameters.push({ name: 'w', expression: '40 mm * 2', value: 80, comment: 'a <b> & "c" ]]>', unit: 'mm' });
  return { d, s };
};

describe('embedded data', () => {
  it('is the project serialisation, in its own namespace with a format, a length and a checksum', () => {
    const { d, s } = demanding();
    const svg = exportSvg(d, [s], { data: true });
    expect(svg).toContain(`xmlns:sketch="${SVG_DATA_NS}"`);
    const data = dataOf(svg);
    expect(data.format).toBe(String(SVG_DATA_FORMAT));
    expect(data.encoding).toBe('base64');
    expect(data.crc32).toMatch(/^[0-9a-f]{8}$/);
    expect(data.crc32).toBe(crc32(Buffer.from(serialize(d), 'utf8')).toString(16).padStart(8, '0'));
    const r = decodeSvgData(data);
    expect(r).toEqual({ ok: true, json: serialize(d) });
    expect(Number(data.bytes)).toBe(new TextEncoder().encode(serialize(d)).length);
  });

  it('keeps the whole design: hidden and locked layers, non-ASCII names, ]]>, < & and quotes, and loads back equal', () => {
    const { d, s } = demanding();
    const r = decodeSvgData(dataOf(exportSvg(d, [s], { data: true })));
    if (!r.ok) throw new Error(r.error);
    const loaded = deserialize(r.json);
    expect(loaded).toEqual({ ok: true, design: d, warnings: [] });
    if (!loaded.ok) return;
    expect(loaded.design.name).toBe(d.name);
    expect(loaded.design.layers.map((l) => [l.name, l.visible, l.locked])).toEqual(d.layers.map((l) => [l.name, l.visible, l.locked]));
    expect(loaded.design.layers.some((l) => !l.visible)).toBe(true);
    expect(loaded.design.activeLayer).toBe(d.activeLayer);
  });

  it('adds nothing to what is drawn, and leaves the hidden layer undrawn', () => {
    const { d, s } = demanding();
    const plain = exportSvg(d, [s]);
    const withData = exportSvg(d, [s], { data: true });
    expect(plain).not.toContain('sketch:design');
    expect(plain).not.toContain('<metadata');
    expect(withData.replace(/\n {2}<metadata>[\s\S]*?<\/metadata>/, '')).toBe(plain);
    expect(withData).not.toContain('y1="-900"');
  });

  it('does not put the design where an XML tool could change it', () => {
    const { d, s } = demanding();
    const svg = exportSvg(d, [s], { data: true });
    const text = dataOf(svg).text;
    expect(text).toMatch(/^[A-Za-z0-9+/]+=*$/);
    for (const raw of ['Größe', '🙂', ']]>', '&amp;']) expect(text).not.toContain(raw);
  });

  it('survives whitespace added or removed by a re-formatter', () => {
    const { d, s } = demanding();
    const data = dataOf(exportSvg(d, [s], { data: true }));
    const wrapped = data.text.replace(/(.{60})/g, '$1\n      ');
    for (const text of [wrapped, `\n   ${data.text}\n  `, data.text.replace(/(.{4})/g, '$1 \t')]) {
      expect(decodeSvgData({ ...data, text })).toEqual({ ok: true, json: serialize(d) });
    }
  });

  it('is the same every time', () => {
    const { d, s } = demanding();
    expect(exportSvg(d, [s], { data: true })).toBe(exportSvg(d, [s], { data: true }));
  });
});

describe('damaged data is reported, never half loaded', () => {
  const sample = (): SvgData => {
    const { d, s } = demanding();
    return dataOf(exportSvg(d, [s], { data: true }));
  };
  const fails = (data: SvgData): string => {
    const r = decodeSvgData(data);
    if (r.ok) throw new Error('decoded');
    return r.error;
  };

  it('cut short', () => {
    const data = sample();
    expect(fails({ ...data, text: data.text.slice(0, data.text.length - 40) })).toMatch(/cut short|incomplete/i);
    expect(fails({ ...data, text: '' })).toMatch(/cut short|incomplete|empty/i);
  });

  it('one character changed', () => {
    const data = sample();
    const i = Math.floor(data.text.length / 2);
    const swapped = data.text[i] === 'A' ? 'B' : 'A';
    expect(fails({ ...data, text: data.text.slice(0, i) + swapped + data.text.slice(i + 1) })).toMatch(/damaged|checksum/i);
  });

  it('the checksum or length edited', () => {
    const data = sample();
    expect(fails({ ...data, crc32: '00000000' })).toMatch(/checksum|damaged/i);
    expect(fails({ ...data, bytes: String(Number(data.bytes) + 3) })).toMatch(/cut short|damaged|incomplete/i);
    expect(fails({ ...data, bytes: 'many' })).toMatch(/damaged/i);
    expect(fails({ ...data, crc32: undefined as unknown as string })).toMatch(/damaged/i);
  });

  it('not base64, or an encoding the app does not know', () => {
    const data = sample();
    expect(fails({ ...data, text: `${data.text.slice(0, 10)}!!${data.text.slice(12)}` })).toMatch(/damaged/i);
    expect(fails({ ...data, encoding: 'rot13' })).toMatch(/encoding/i);
  });

  it('from a newer format, which says so', () => {
    const data = sample();
    const error = fails({ ...data, format: String(SVG_DATA_FORMAT + 1) });
    expect(error).toMatch(/newer/i);
    expect(error).toContain(String(SVG_DATA_FORMAT + 1));
    expect(fails({ ...data, format: 'x' })).toMatch(/damaged/i);
    expect(fails({ ...data, format: '0' })).toMatch(/damaged/i);
  });
});

describe('what a file is', () => {
  it('knows an SVG by its extension or its first character, and a project by neither', () => {
    expect(looksLikeSvg('anything', 'a.svg')).toBe(true);
    expect(looksLikeSvg('anything', 'A.SVG')).toBe(true);
    expect(looksLikeSvg('﻿  <?xml version="1.0"?><svg/>', 'x')).toBe(true);
    expect(looksLikeSvg('{"version":2}', 'x.sketch.json')).toBe(false);
    expect(looksLikeSvg('not json', 'x.json')).toBe(false);
    expect(looksLikeSvg('{"version":2}', '')).toBe(false);
  });

  it('has a plain message for an SVG with no data', () => {
    expect(NO_SVG_DATA).toMatch(/no editable data/i);
    expect(NO_SVG_DATA).toMatch(/Include editable data/);
  });

  it('keeps the project format as it was', () => {
    const { d } = demanding();
    expect(JSON.parse(serialize(d)).version).toBe(DESIGN_VERSION);
  });
});

describe('what an editable SVG will carry', () => {
  /** Two hidden layers, three construction lines (one on a hidden layer), a circle on a visible one. */
  const loaded = (): { d: Design; s: Sketch } => {
    const d = newDesign();
    const s = newSketch(d);
    addLine(d, s, { x: 0, y: 0 }, { x: 40, y: 0 });
    addLine(d, s, { x: 0, y: 5 }, { x: 40, y: 5 }).lineType = 'construction';
    addLine(d, s, { x: 0, y: 6 }, { x: 40, y: 6 }).lineType = 'construction';
    const h1 = addLayer(d);
    h1.name = 'Secret Alpha';
    addLine(d, s, { x: 0, y: 70 }, { x: 40, y: 70 }).lineType = 'construction';
    h1.visible = false;
    const h2 = addLayer(d);
    h2.name = 'Secret Beta';
    addLine(d, s, { x: 0, y: 80 }, { x: 40, y: 80 });
    h2.visible = false;
    return { d, s };
  };

  it('counts hidden layers and construction lines that are not drawn, and follows the options', () => {
    const { d, s } = loaded();
    expect(embedSummary(d, [s], { construction: false })).toMatchObject({ hiddenLayers: 2, constructionLines: 3, constructionCurves: 0, otherSketches: 0 });
    // Drawn construction on a shown layer is no secret; what sits on a hidden layer still is.
    expect(embedSummary(d, [s], { construction: true })).toMatchObject({ hiddenLayers: 2, constructionLines: 1 });
    expect(embedSentence(embedSummary(d, [s], { construction: false }))).toBe('Includes 2 hidden layers and 3 construction lines.');
    expect(embedSentence(embedSummary(d, [s], { construction: true }))).toBe('Includes 2 hidden layers and 1 construction line.');
  });

  it('counts the other sketches of the design, and non-line construction as curves', () => {
    const { d, s } = loaded();
    const other = newSketch(d);
    addLine(d, other, { x: 0, y: 0 }, { x: 1, y: 1 });
    addCircle(d, s, { x: 3, y: 3 }, 2).lineType = 'construction';
    const sum = embedSummary(d, [s], { construction: false });
    expect(sum).toMatchObject({ otherSketches: 1, constructionLines: 3, constructionCurves: 1 });
    expect(embedSentence(sum)).toBe('Includes 2 hidden layers, 3 construction lines, 1 other construction curve and 1 other sketch.');
  });

  it('says plainly when there is nothing beyond the drawing', () => {
    const d = newDesign();
    const s = newSketch(d);
    addLine(d, s, { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(embedSentence(embedSummary(d, [s], {}))).toBe('Includes the whole design: no hidden layers and no construction lines.');
  });

  it('with the data unticked the file holds no metadata, no hidden layer and no construction', () => {
    const { d, s } = loaded();
    const svg = exportSvg(d, [s], { data: false });
    expect(svg).not.toContain('<metadata');
    expect(svg).not.toContain(SVG_DATA_NS);
    expect(svg).not.toContain('sketch:design');
    expect(svg).not.toContain('Secret');
    expect(svg).not.toContain('stroke-dasharray');
    expect(svg).not.toContain('y1="-5"');
    expect(svg).not.toContain('y1="-70"');
    expect(svg).not.toContain('y1="-80"');
    // And nothing that could be the design: no long base64 run.
    expect(/[A-Za-z0-9+/]{200,}/.test(svg)).toBe(false);
    // The default of the options object is also no data.
    expect(exportSvg(d, [s])).toBe(svg);
  });
});
