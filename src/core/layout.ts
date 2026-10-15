/**
 * Word's layout model for the cue sheet templates: how Word measures 맑은 고딕 text, wraps
 * lines and sizes table rows. Calibrated against Word's own PDFs; shared by the DOCX writer
 * (row heights, page fit) and the page preview (which draws exactly these lines and rows).
 */

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// ---------- DOM helpers (namespace-aware; work with the browser DOM and @xmldom/xmldom) ----------
export const isEl = (n: Node | null | undefined): n is Element => !!n && n.nodeType === 1;
export function kids(el: Node | undefined, name?: string): Element[] {
  const out: Element[] = [];
  if (!el) return out;
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes.item(i);
    if (isEl(c) && c.namespaceURI === W && (!name || c.localName === name)) out.push(c);
  }
  return out;
}
export const kid = (el: Node | undefined, name: string): Element | undefined => kids(el, name)[0];
export function all(el: Element | Document, name: string): Element[] {
  const nl = el.getElementsByTagNameNS(W, name);
  const out: Element[] = [];
  for (let i = 0; i < nl.length; i++) out.push(nl.item(i) as Element);
  return out;
}
export const attr = (el: Element | undefined, name: string): string | null =>
  el && el.hasAttributeNS(W, name) ? el.getAttributeNS(W, name) : null;
export const num = (el: Element | undefined, name: string): number | null => {
  const v = attr(el, name);
  return v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v);
};
export const textOf = (el: Element) => all(el, 't').map((t) => t.textContent ?? '').join('');
export const nfc = (s: string) => s.normalize('NFC').replace(/\s+/g, '');
export const on = (el: Element | undefined) => !!el && !/^(0|false|off)$/.test(attr(el, 'val') ?? '');

// ---------- text metrics: 맑은 고딕 (Malgun Gothic), the templates' theme font ----------
/** advance widths (1/1000 em) of U+0020..U+007E, from the font's hmtx table */
export const REG = [352,289,395,606,551,836,818,232,305,305,425,701,219,410,219,396,551,551,551,551,551,551,551,551,551,551,219,219,701,701,701,460,979,658,583,635,717,517,499,702,725,270,360,590,480,917,765,773,571,773,610,543,534,703,634,954,601,563,583,305,764,305,701,426,272,520,601,473,602,535,316,602,579,246,246,506,246,880,578,599,601,602,354,433,345,578,487,736,465,493,462,305,239,305,701];
export const BOLD = [352,323,476,608,580,875,857,282,358,358,456,719,262,414,262,439,580,580,580,580,580,580,580,580,580,580,262,262,719,719,719,452,979,704,637,639,746,539,524,722,770,310,431,645,512,964,798,776,615,776,654,566,583,731,671,1010,653,606,611,358,764,358,719,426,309,543,626,487,626,550,373,626,607,274,279,555,274,923,608,620,626,626,394,462,384,608,537,795,539,536,483,358,309,358,719];
/** Word's single line for this East Asian font: 1.3 × (win ascent + descent), as measured in Word's PDFs */
export const LINE_EM = ((2229 + 495) / 2048) * 1.3;
/** the font's ascent and descent (win metrics) for a size in half-points, in twips */
export const ascentTw = (sz: number) => (sz * 10 * 2229) / 2048;
export const descentTw = (sz: number) => (sz * 10 * 495) / 2048;

/** Document-wide settings that change how Word measures text. */
export interface Metrics {
  /** the Normal style keeps Korean words whole (`w:wordWrap`) */
  wordWrap: boolean;
  /** settings.xml `balanceSingleByteDoubleByteWidth`: a space next to Korean text is half an em wide */
  balance: boolean;
  /** the Normal style's paragraph alignment */
  jc: string;
}
/** Reads the document-wide measuring settings from styles.xml and settings.xml. */
export function metricsOf(styles?: string, settings?: string): Metrics {
  const normal = styles && /<w:style\b(?=[^>]*w:type="paragraph")(?=[^>]*w:default="1")[^>]*>((?:(?!<\/w:style>)[\s\S])*)<\/w:style>/.exec(styles)?.[1];
  const wrap = normal && /<w:wordWrap\b([^>]*)\/>/.exec(normal);
  const jc = normal && /<w:jc\b[^>]*w:val="([^"]+)"/.exec(normal);
  const balance = settings && /<w:balanceSingleByteDoubleByteWidth\b([^>]*)\/>/.exec(settings);
  return {
    wordWrap: !wrap || !/w:val="(0|false|off)"/.test(wrap[1]),
    balance: !!balance && !/w:val="(0|false|off)"/.test(balance[1]),
    jc: (jc && jc[1]) || 'left',
  };
}

export interface Style { sz: number; w: number; bold: boolean }
export function charEm(ch: string, bold: boolean): number {
  const c = ch.codePointAt(0)!;
  if (c >= 0x20 && c <= 0x7e) return (bold ? BOLD : REG)[c - 0x20] / 1000;
  if ((c >= 0x1100 && c <= 0x11ff) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0x25a0 && c <= 0x25ff) || (c >= 0x2600 && c <= 0x27bf)) return 1;
  switch (ch) {
    case '’': case '‘': return bold ? 0.279 : 0.231;
    case '“': case '”': return bold ? 0.472 : 0.379;
    case '·': return bold ? 0.262 : 0.219;
    case '…': return bold ? 0.882 : 0.74;
    case '→': case '←': return bold ? 1 : 0.95;
    case '\t': return 2;
  }
  return 0.6;
}
export const emTw = (st: Style) => (st.sz * 10 * st.w) / 100; // twips per em
export function styleOf(rPr: Element | undefined): Style {
  return { sz: num(kid(rPr, 'sz'), 'val') ?? 20, w: num(kid(rPr, 'w'), 'val') ?? 100, bold: on(kid(rPr, 'b')) };
}

export const isCJK = (ch: string) => {
  const c = ch.codePointAt(0)!;
  return (c >= 0x1100 && c <= 0x11ff) || (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xff60);
};
export interface Glyph { ch: string; w: number; em: number }
export const glyph = (ch: string, st: Style): Glyph => ({ ch, em: emTw(st), w: charEm(ch, st.bold) * emTw(st) });
export const eastAsian = (ch: string) => isCJK(ch) || '‘’“”'.includes(ch);
/**
 * How Word draws spaces when the document balances single- and double-byte text: half an em,
 * except a lone space between two Latin characters (letters, digits, punctuation), which keeps
 * the font's width. Spaces touching Korean text, spaces starting a line and every run of two or
 * more are all half an em (measured in Word's PDFs).
 */
export function balanceSpaces(gs: Glyph[]) {
  for (let i = 0; i < gs.length; ) {
    if (gs[i].ch !== ' ') { i++; continue; }
    let j = i;
    while (j < gs.length && gs[j].ch === ' ') j++;
    const l = gs[i - 1], r = gs[j];
    const lone = j - i === 1 && !!l && !!r && !eastAsian(l.ch) && !eastAsian(r.ch);
    if (!lone) for (let k = i; k < j; k++) gs[k].w = gs[k].em / 2;
    i = j;
  }
}
export function textWidth(s: string, st: Style, m: Metrics): number {
  const gs = [...s].map((ch) => glyph(ch, st));
  if (m.balance) balanceSpaces(gs);
  return gs.reduce((a, g) => a + g.w, 0);
}
/**
 * A character (or inline object) on a line; `run` points into the paragraph's runs. An object
 * has its height `h` (effects included) and `below`, how far its effects (a shadow) reach below it.
 */
export interface PGlyph extends Glyph { run: number; obj?: Element; h?: number; below?: number }
export interface Run { rPr: Element | undefined; st: Style }
/**
 * Where Word starts each line: after spaces and inner hyphens, and also between Korean
 * characters when the paragraph allows breaking inside Korean words (`cjkBreak`). A word
 * wider than the whole line is split between characters. Returns [segment, glyph] starts.
 */
export function lineStarts(segs: { ch: string; w: number }[][], first: number, rest: number, cjkBreak: boolean): [number, number][] {
  const starts: [number, number][] = [];
  segs.forEach((seg, si) => {
    starts.push([si, 0]);
    let avail = starts.length === 1 ? first : rest;
    // atoms: [first glyph, end glyph (exclusive, spaces excluded), width, trailing spaces' width]
    const atoms: [number, number, number, number][] = [];
    let a = 0, trail = 0, from = 0, to = 0;
    seg.forEach(({ ch, w }, i) => {
      if (ch === ' ') { trail += w; return; }
      const cjk = cjkBreak && isCJK(ch);
      if (trail || (cjk && a)) { atoms.push([from, to, a, trail]); a = 0; trail = 0; from = i; }
      a += w;
      to = i + 1;
      if (cjk || (ch === '-' && i > 0 && seg[i - 1].ch !== ' ' && seg[i + 1] && seg[i + 1].ch !== ' ')) { atoms.push([from, to, a, 0]); a = 0; from = i + 1; }
    });
    if (a || trail) atoms.push([from, Math.max(from, to), a, trail]);
    let cur = 0;
    for (const [s, e, aw, tw] of atoms) {
      if (cur > 0 && cur + aw > avail) { starts.push([si, s]); avail = rest; cur = 0; }
      let x = aw;
      if (cur === 0 && x > avail) {
        // too wide for any line: break between its characters
        let run = 0;
        for (let i = s; i < e; i++) {
          const w = seg[i].w;
          if (run > 0 && run + w > avail) { starts.push([si, i]); avail = rest; run = 0; }
          run += w;
        }
        x = run;
      }
      cur += x + tw;
    }
  });
  return starts.length ? starts : [[0, 0]];
}
export const countLines = (segs: { ch: string; w: number }[][], first: number, rest: number, cjkBreak: boolean): number =>
  lineStarts(segs, first, rest, cjkBreak).length;

const RUN_HOLDERS = new Set(['hyperlink', 'smartTag', 'ins', 'sdt', 'sdtContent', 'fldSimple', 'customXml', 'moveTo']);
/** The runs of a paragraph in reading order, including those inside links, fields and content controls. */
export function paraRuns(p: Element): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => {
    for (const c of kids(el)) {
      if (c.localName === 'r') out.push(c);
      else if (RUN_HOLDERS.has(c.localName)) walk(c);
    }
  };
  walk(p);
  return out;
}
const EMU_TW = 1 / 635; // twips per EMU
/** Size of an inline drawing on its line (twips), shadows and glow included; `below`: the effects under it. */
export function inlineSize(inline: Element): { w: number; h: number; below: number } {
  const ext = inline.getElementsByTagNameNS(WP, 'extent').item(0);
  const eff = inline.getElementsByTagNameNS(WP, 'effectExtent').item(0);
  const n = (e: Element | null, a: string) => Number(e?.getAttribute(a) ?? 0) || 0;
  return {
    w: (n(ext, 'cx') + n(eff, 'l') + n(eff, 'r')) * EMU_TW,
    h: (n(ext, 'cy') + n(eff, 't') + n(eff, 'b')) * EMU_TW,
    below: n(eff, 'b') * EMU_TW,
  };
}
export const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
/** Inline drawings of a run: the DrawingML choice of `mc:AlternateContent`, never the VML fallback. */
export function runInlines(r: Element): Element[] {
  const out: Element[] = [];
  const visit = (el: Element) => {
    for (let i = 0; i < el.childNodes.length; i++) {
      const c = el.childNodes.item(i);
      if (!isEl(c)) continue;
      if (c.namespaceURI === MC && c.localName === 'Fallback') continue;
      if (c.namespaceURI === WP && c.localName === 'inline') out.push(c);
      else if (c.namespaceURI === WP && c.localName === 'anchor') continue;
      else visit(c);
    }
  };
  visit(r);
  return out;
}

export interface ParaLine {
  glyphs: PGlyph[];
  /** width without the spaces that end the line (Word lets them hang past the edge) */
  width: number;
  /** height of the line: the paragraph's pitch, or taller for an inline drawing */
  height: number;
  /** last line of the paragraph or before a manual line break (never justified) */
  end: boolean;
  /** an inline drawing sits on this line: its height including effects (twips) */
  obj: number;
  /** with a drawing: how far the line reaches below its baseline (the text's descent or the drawing's shadow) */
  below: number;
}
export interface ParaLayout {
  lines: ParaLine[];
  runs: Run[];
  /** height of one text line */
  pitch: number;
  before: number;
  after: number;
  left: number;
  right: number;
  /** first-line indent (negative: hanging) */
  firstExtra: number;
  jc: string;
  /** largest font size on the paragraph (half-points) */
  sz: number;
  /** lines have an exact height (a negative `line` means exact too) */
  exact: boolean;
  height: number;
}
/** How Word lays out a paragraph `avail` twips wide: its lines, their glyphs and the paragraph's height. */
export function paraLayout(p: Element, avail: number, m: Metrics): ParaLayout {
  const pPr = kid(p, 'pPr');
  const ww = kid(pPr, 'wordWrap');
  const segs: PGlyph[][] = [[]];
  const runs: Run[] = [];
  let sz = 0;
  for (const r of paraRuns(p)) {
    const rPr = kid(r, 'rPr');
    const st = styleOf(rPr);
    const ri = runs.push({ rPr, st }) - 1;
    const seg = () => segs[segs.length - 1];
    for (const c of kids(r)) {
      const n = c.localName;
      if (n === 't') {
        for (const ch of c.textContent ?? '') {
          seg().push({ ...glyph(ch, st), run: ri });
          // Word sizes a line by what it shows: spaces never make it taller
          if (!/\s/.test(ch)) sz = Math.max(sz, st.sz);
        }
      } else if ((n === 'br' && !attr(c, 'type')) || n === 'cr') segs.push([]);
      else if (n === 'tab') seg().push({ ch: '\t', em: emTw(st), w: 2 * emTw(st), run: ri });
      else if (n === 'noBreakHyphen') seg().push({ ...glyph('-', st), run: ri });
    }
    for (const d of runInlines(r)) {
      const { w, h, below } = inlineSize(d);
      seg().push({ ch: '\ufffc', em: emTw(st), w, run: ri, obj: d, h, below });
      sz = Math.max(sz, st.sz);
    }
  }
  if (m.balance) segs.forEach(balanceSpaces);
  // the paragraph mark's own size counts too, when the template sets one
  sz = Math.max(sz, num(kid(kid(pPr, 'rPr'), 'sz'), 'val') ?? 0) || 20;
  const sp = kid(pPr, 'spacing');
  const ind = kid(pPr, 'ind');
  const natural = sz * 10 * LINE_EM;
  const line = num(sp, 'line');
  const rule = attr(sp, 'lineRule') ?? 'auto';
  const exact = line != null && (rule === 'exact' || line < 0);
  const pitch = line == null ? natural : exact ? Math.abs(line) : rule === 'atLeast' ? Math.max(line, natural) : (natural * line) / 240;
  const left = num(ind, 'left') ?? num(ind, 'start') ?? 0;
  const right = num(ind, 'right') ?? num(ind, 'end') ?? 0;
  const firstExtra = (num(ind, 'firstLine') ?? 0) - (num(ind, 'hanging') ?? 0);
  const rest = Math.max(100, avail - left - right);
  const starts = lineStarts(segs, Math.max(100, rest - firstExtra), rest, !(ww ? on(ww) : m.wordWrap));
  const lines: ParaLine[] = starts.map(([si, gi], k) => {
    const next = starts[k + 1];
    const glyphs = segs[si].slice(gi, next && next[0] === si ? next[1] : undefined);
    let end = glyphs.length;
    while (end > 0 && glyphs[end - 1].ch === ' ') end--;
    const width = glyphs.slice(0, end).reduce((a, g) => a + g.w, 0);
    // an inline picture stands on the baseline and its shadow hangs into the text's descent: the line is
    // the picture plus whichever reaches lower (no extra leading, as Word draws it)
    const obj = glyphs.reduce((h, g) => Math.max(h, g.h ?? 0), 0);
    const above = glyphs.reduce((h, g) => Math.max(h, (g.h ?? 0) - (g.below ?? 0)), 0);
    const below = glyphs.reduce((h, g) => Math.max(h, g.below ?? 0), descentTw(sz));
    const height = obj && !exact ? Math.max(pitch, above + below) : pitch;
    return { glyphs, width, height, end: !next || next[0] !== si, obj, below: obj ? below : 0 };
  });
  const before = kid(pPr, 'contextualSpacing') ? 0 : num(sp, 'before') ?? 0;
  const after = kid(pPr, 'contextualSpacing') ? 0 : num(sp, 'after') ?? 0;
  const jc = attr(kid(pPr, 'jc'), 'val') ?? m.jc;
  return {
    lines, runs, pitch, before, after, left, right, firstExtra, jc, sz, exact,
    height: lines.reduce((h, l) => h + l.height, 0) + before + after,
  };
}
export const paraHeight = (p: Element, avail: number, m: Metrics): number => paraLayout(p, avail, m).height;
/** Border thickness in twips (`sz` is in eighths of a point). */
export function borderTw(b: Element | undefined): number {
  const v = attr(b, 'val');
  return !b || !v || v === 'nil' || v === 'none' ? 0 : ((num(b, 'sz') ?? 4) * 20) / 8;
}
export interface Box {
  grid: number[];
  mar: { top: number; bottom: number; left: number; right: number };
  /** borders between rows, above the first row and below the last row (twips) */
  rule: number;
  edgeTop: number;
  edgeBottom: number;
  m: Metrics;
}
export function boxOf(tbl: Element, m: Metrics): Box {
  const tblPr = kid(tbl, 'tblPr');
  const cm = kid(tblPr, 'tblCellMar');
  const bd = kid(tblPr, 'tblBorders');
  const g = (a: string, b?: string) => num(kid(cm, a) ?? (b ? kid(cm, b) : undefined), 'w');
  return {
    m,
    grid: kids(kid(tbl, 'tblGrid'), 'gridCol').map((c) => num(c, 'w') ?? 0),
    mar: { top: g('top') ?? 0, bottom: g('bottom') ?? 0, left: g('left', 'start') ?? 108, right: g('right', 'end') ?? 108 },
    rule: borderTw(kid(bd, 'insideH')),
    edgeTop: borderTw(kid(bd, 'top')),
    edgeBottom: borderTw(kid(bd, 'bottom')),
  };
}
/** Width of each cell of a row (grid columns it spans). */
export function cellWidths(tr: Element, box: Box): number[] {
  let gi = num(kid(kid(tr, 'trPr'), 'gridBefore'), 'val') ?? 0;
  return kids(tr, 'tc').map((tc) => {
    const span = num(kid(kid(tc, 'tcPr'), 'gridSpan'), 'val') ?? 1;
    const w = box.grid.slice(gi, gi + span).reduce((a, b) => a + b, 0);
    gi += span;
    return w || 1000;
  });
}
export function cellMar(tc: Element, box: Box) {
  const m = kid(kid(tc, 'tcPr'), 'tcMar');
  const g = (side: 'top' | 'bottom' | 'left' | 'right', alt?: string) => num(kid(m, side) ?? (alt ? kid(m, alt) : undefined), 'w') ?? box.mar[side];
  return { top: g('top'), bottom: g('bottom'), left: g('left', 'start'), right: g('right', 'end') };
}
export const textArea = (tc: Element, width: number, box: Box) => { const m = cellMar(tc, box); return width - m.left - m.right; };
/** Height of a cell's paragraphs, without the cell margins. */
export function cellHeight(tc: Element, width: number, box: Box): number {
  return kids(tc, 'p').reduce((h, p) => h + paraHeight(p, textArea(tc, width, box), box.m), 0);
}
export const isMerged = (tc: Element) => !!kid(kid(tc, 'tcPr'), 'vMerge');
/** Content height of a row, without margins; vertically merged cells are skipped when `skipMerged`. */
export function contentHeight(tr: Element, box: Box, skipMerged = false): number {
  const ws = cellWidths(tr, box);
  return Math.ceil(kids(tr, 'tc').reduce((h, tc, i) => (skipMerged && isMerged(tc) ? h : Math.max(h, cellHeight(tc, ws[i], box))), 0));
}
export const cellBorder = (tc: Element, side: 'top' | 'bottom') => kid(kid(kid(tc, 'tcPr'), 'tcBorders'), side);
/** The widest border a row's cells draw on one side; cells without their own use `fallback` (the table's). */
const sideRule = (tr: Element, side: 'top' | 'bottom', fallback: number) =>
  kids(tr, 'tc').reduce((r, tc) => { const b = cellBorder(tc, side); return Math.max(r, b ? borderTw(b) : fallback); }, 0);
function nextRow(tr: Element): Element | undefined {
  for (let n = tr.nextSibling; n; n = n.nextSibling) if (isEl(n) && n.namespaceURI === W && n.localName === 'tr') return n;
  return undefined;
}
/**
 * The room Word leaves for the border below a row: the widest top border of the next row's cells
 * (a thicker bottom border above simply overlaps the next row), or under the last row, its widest
 * bottom border (measured in Word).
 */
export function gapBelow(tr: Element, box: Box): number {
  const next = nextRow(tr);
  return next ? sideRule(next, 'top', box.rule) : sideRule(tr, 'bottom', box.edgeBottom);
}
/**
 * What Word adds on top of a row's height: every cell gets the row's largest top and bottom
 * margins (even cells set to less), then the room for the border below the row.
 */
export function rowExtra(tr: Element, box: Box): number {
  let top = 0, bottom = 0;
  for (const tc of kids(tr, 'tc')) {
    const m = cellMar(tc, box);
    top = Math.max(top, m.top);
    bottom = Math.max(bottom, m.bottom);
  }
  return top + bottom + gapBelow(tr, box);
}
/** The room above a table's first row, for its widest top border. */
export const topEdge = (tr: Element, box: Box) => sideRule(tr, 'top', box.edgeTop);
/** Height of a row on the page. */
export function renderedHeight(tr: Element, box: Box, skipMerged = true): number {
  const th = kid(kid(tr, 'trPr'), 'trHeight');
  const h = num(th, 'val') ?? 0;
  return (attr(th, 'hRule') === 'exact' ? h : Math.max(h, contentHeight(tr, box, skipMerged))) + rowExtra(tr, box);
}
export function tableHeight(tbl: Element, box: Box): number {
  const rows = kids(tbl, 'tr');
  return rows.length ? topEdge(rows[0], box) + rows.reduce((h, r) => h + renderedHeight(r, box), 0) : 0;
}
