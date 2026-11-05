// Editable SVG [user]: Save as SVG can carry the whole design in <metadata>, and File > Open reads it back.
// The design is the project file's own JSON, as base64 of its UTF-8, so no XML tool can change a character of it,
// and it comes with its length and a CRC-32 so that a file cut short or altered is reported, never half loaded.
import type { Design } from '../model/types';
import { DESIGN_VERSION } from '../model/types';
import { deserialize, serialize, type LoadResult } from './project';

/** The app's own XML namespace. Never fetched: it only names the element. */
export const SVG_DATA_NS = 'urn:sketch-cad:design';
/** Version of this wrapper (element, attributes, encoding). The design inside has its own `version`. */
export const SVG_DATA_FORMAT = 1;
const SVG_NS = 'http://www.w3.org/2000/svg';

export const NO_SVG_DATA = 'This SVG has no editable data, so it cannot be opened as a drawing. '
  + 'Only an SVG saved from Sketch with "Include editable data" ticked can be opened.';
const NOT_SVG = 'This file is not a valid SVG, so it cannot be opened.';
const DAMAGED = 'The editable data in this SVG is damaged';

/** The data element as it stands in the file: attributes and text, before any check. */
export interface SvgData {
  format: string | null;
  encoding: string | null;
  bytes: string | null;
  crc32: string | null;
  text: string;
}

export type SvgDataResult = { ok: true; json: string } | { ok: false; error: string };

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): string {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** The `<metadata>` element for a design. Fixed output for a fixed design. */
export function dataMarkup(design: Design): string {
  const bytes = new TextEncoder().encode(serialize(design));
  const attrs = `format="${SVG_DATA_FORMAT}" encoding="base64" bytes="${bytes.length}" crc32="${crc32(bytes)}"`;
  return `<metadata>\n    <sketch:design xmlns:sketch="${SVG_DATA_NS}" ${attrs}>${toBase64(bytes)}</sketch:design>\n  </metadata>`;
}

/** Check and decode what a data element holds: the project JSON, or why it cannot be trusted. */
export function decodeSvgData(data: SvgData): SvgDataResult {
  const damaged = (why: string): SvgDataResult => ({ ok: false, error: `${DAMAGED} (${why}), so it was not opened.` });
  const format = data.format ?? '';
  if (!/^[1-9]\d*$/.test(format)) return damaged('no valid format number');
  if (Number(format) > SVG_DATA_FORMAT) {
    return { ok: false, error: `This SVG was saved by a newer version of Sketch (data format ${format}). Update Sketch to open it.` };
  }
  if (data.encoding !== 'base64') return { ok: false, error: `This SVG's editable data uses an encoding (${String(data.encoding)}) this version of Sketch does not know.` };
  if (!/^\d+$/.test(data.bytes ?? '') || !/^[0-9a-f]{8}$/i.test(data.crc32 ?? '')) return damaged('its length or checksum is missing');
  const bytes = Number(data.bytes);
  // Whatever a tool did between elements, none of it is part of the base64.
  const text = data.text.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return damaged('it is not base64');
  const expected = 4 * Math.ceil(bytes / 3);
  if (text.length < expected) return { ok: false, error: `The editable data in this SVG is incomplete (the file looks cut short), so it was not opened.` };
  if (text.length > expected) return damaged('it is longer than it says');
  let raw: Uint8Array;
  try {
    raw = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    return damaged('it is not base64');
  }
  if (raw.length !== bytes) return damaged('its length does not match');
  if (crc32(raw) !== (data.crc32 ?? '').toLowerCase()) return damaged('the checksum does not match');
  try {
    return { ok: true, json: new TextDecoder('utf-8', { fatal: true }).decode(raw) };
  } catch {
    return damaged('it is not text');
  }
}

/** Whether File > Open should read this as an SVG: by its name, or by starting like markup. */
export const looksLikeSvg = (text: string, fileName: string): boolean => /\.svg$/i.test(fileName) || /^﻿?\s*</.test(text);

/** The data element of an SVG file. The file is only ever parsed: nothing from it enters the page. */
function findData(text: string): SvgData | { error: string } {
  // A file of ours declares no entities; one that does is not read, so none can be expanded.
  if (/<!ENTITY/i.test(text)) return { error: 'This SVG declares XML entities, which Sketch does not read.' };
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || doc.getElementsByTagName('parsererror').length) {
    // Ours, then, but not whole: the usual end of a file that was cut short.
    return { error: text.includes(SVG_DATA_NS) ? 'This SVG looks cut short or damaged, so it was not opened.' : NOT_SVG };
  }
  if (root.localName !== 'svg' || root.namespaceURI !== SVG_NS) return { error: NOT_SVG };
  const el = doc.getElementsByTagNameNS(SVG_DATA_NS, 'design')[0];
  if (!el) return { error: NO_SVG_DATA };
  return {
    format: el.getAttribute('format'), encoding: el.getAttribute('encoding'), bytes: el.getAttribute('bytes'),
    crc32: el.getAttribute('crc32'), text: el.textContent ?? '',
  };
}

/** What File > Open does with an SVG: the embedded design through the project loader, or a message saying why not. */
export function loadSvg(text: string): LoadResult {
  const found = findData(text);
  if ('error' in found) return { ok: false, error: found.error };
  const data = decodeSvgData(found);
  if (!data.ok) return data;
  let version: unknown;
  try {
    version = (JSON.parse(data.json) as { version?: unknown }).version;
  } catch {
    // The loader reports it.
  }
  if (typeof version === 'number' && version > DESIGN_VERSION) {
    return { ok: false, error: `The design in this SVG is from a newer version of Sketch (design version ${version}). Update Sketch to open it.` };
  }
  const r = deserialize(data.json);
  return r.ok ? r : { ok: false, error: `The editable data in this SVG could not be opened: ${r.error}` };
}
