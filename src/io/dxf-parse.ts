// Reading a DXF file back, to check a round trip. Apart from dxf.ts so it stays free of the font stack.

/** One parsed entity: its type, layer and numeric groups, for reading a file back. */
export interface DxfEntity { type: string; layer: string; values: Map<number, number> }

export function parseDxfEntities(text: string): DxfEntity[] {
  const rows = text.split(/\r?\n/);
  const out: DxfEntity[] = [];
  let inside = false;
  let current: DxfEntity | null = null;
  for (let i = 0; i + 1 < rows.length; i += 2) {
    const code = Number(rows[i].trim());
    const value = rows[i + 1].trim();
    if (code === 2 && value === 'ENTITIES') inside = true;
    if (!inside) continue;
    if (code === 0) {
      if (value === 'ENDSEC') break;
      current = { type: value, layer: '', values: new Map() };
      out.push(current);
    } else if (current && code === 8) current.layer = value;
    else if (current && Number.isFinite(Number(value))) current.values.set(code, Number(value));
  }
  return out;
}

/** The LAYER table of a DXF file, as name to ACI colour. */
export function parseDxfLayers(text: string): Map<string, number> {
  const rows = text.split(/\r?\n/);
  const out = new Map<string, number>();
  for (let i = 0; i + 1 < rows.length; i += 2) {
    if (rows[i].trim() !== '0' || rows[i + 1].trim() !== 'LAYER') continue;
    let name = '';
    for (let j = i + 2; j + 1 < rows.length && rows[j].trim() !== '0'; j += 2) {
      if (rows[j].trim() === '2') name = rows[j + 1].trim();
      if (rows[j].trim() === '62') out.set(name, Number(rows[j + 1].trim()));
    }
  }
  return out;
}

export interface DxfCounts {
  LINE: number; CIRCLE: number; ARC: number; POINT: number; POLYLINE: number; VERTEX: number; SEQEND: number; other: number;
  /** R12 $ACADVER, if present. */
  version: string | null;
  /** True when SECTION/ENDSEC pair up and the file ends with EOF. */
  wellFormed: boolean;
}

/** Tally a DXF file's entities: enough to verify a round trip. */
export function parseDxfCounts(text: string): DxfCounts {
  const counts: DxfCounts = { LINE: 0, CIRCLE: 0, ARC: 0, POINT: 0, POLYLINE: 0, VERTEX: 0, SEQEND: 0, other: 0, version: null, wellFormed: false };
  const rows = text.split(/\r?\n/);
  let section: string | null = null;
  let depth = 0;
  let sawEof = false;
  let awaiting: string | null = null;
  for (let i = 0; i + 1 < rows.length; i += 2) {
    const code = Number(rows[i].trim());
    const value = rows[i + 1].trim();
    if (code === 9 && value === '$ACADVER') awaiting = 'ver';
    else if (code === 1 && awaiting === 'ver') {
      counts.version = value;
      awaiting = null;
    }
    if (code === 2 && rows[i - 2]?.trim() === '0' && rows[i - 1]?.trim() === 'SECTION') section = value;
    if (code !== 0) continue;
    if (value === 'SECTION') depth++;
    else if (value === 'ENDSEC') {
      depth--;
      section = null;
    } else if (value === 'EOF') sawEof = true;
    else if (section === 'ENTITIES') {
      if (value in counts && value !== 'other') counts[value as 'LINE']++;
      else counts.other++;
    }
  }
  counts.wellFormed = depth === 0 && sawEof;
  return counts;
}
