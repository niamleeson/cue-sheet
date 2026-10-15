/**
 * Draws a finished cue sheet page the way Word lays it out. Lines, row heights and positions
 * come from the same layout model the DOCX writer uses (layout.ts, calibrated against Word's
 * PDFs); every character is placed where that model puts it, so line breaks match Word even
 * when the screen's font differs. The stage diagram is drawn from its DrawingML: theme colours,
 * gradients, outlines and shadows. Output is one SVG in points.
 */
import {
  W, WP, ascentTw, attr, borderTw, boxOf, cellHeight, cellMar, descentTw, gapBelow, isEl, kid, kids, nfc, num, paraLayout, renderedHeight, rowExtra, textOf, topEdge,
} from './layout';
import type { Box, Metrics, ParaLayout } from './layout';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

/** The templates' font, 맑은 고딕: the app loads Word's own copy as CueMalgun where it can. */
export const FONT = `'CueMalgun','Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR','Noto Sans CJK KR',sans-serif`;
/** Where Word puts the baseline in a line: this share of the line's extra leading goes above the text. */
export const LEAD_ABOVE = 0.5;
/** …except in a line of exact height, where the baseline is this far down the line whatever the font. */
export const EXACT_BASE = 0.8;

type Parser = { parseFromString(s: string, type: string): Document };
interface Rect { x: number; y: number; w: number; h: number }

export interface PageInput {
  xml: string;
  theme?: string;
  metrics: Metrics;
  rows: { table: number; first: number };
}
export interface RenderOptions {
  /** keys of the service rows, top to bottom (the sheet's rows) */
  rowKeys: string[];
  /** prefix for the SVG's ids (gradients, shadows), unique on the screen */
  id?: string;
}
export interface PageRow { key: string; x: number; y: number; w: number; h: number }
/**
 * A table cell on the page (pt). `table` counts the body's tables; the cell starts in row `row` (and runs to `last`
 * when merged down) and covers grid columns `g0` to `g1` (exclusive). `paras` are its paragraphs, top to bottom.
 */
export interface PageCell {
  table: number;
  row: number;
  last: number;
  g0: number;
  g1: number;
  x: number;
  y: number;
  w: number;
  h: number;
  paras: { y: number; h: number; text: string }[];
}
export interface PageRender {
  svg: string;
  /** page size (pt) */
  width: number;
  height: number;
  /** lowest point drawn (pt): more than `height` means the sheet runs onto a second page */
  bottom: number;
  /** height of the SVG's view box (pt): the page, or more when the sheet runs past it */
  viewHeight: number;
  /** the service rows on the page (pt) */
  rows: PageRow[];
  /** every table cell (pt), for clicking a cell to edit it */
  cells: PageCell[];
  /** first-row label of each grid column, per body table (NFC, spaces removed) */
  tables: string[][];
  /** the cue sheet table and its first service row */
  timeline: { table: number; first: number };
}

// ---------- small helpers ----------
const kidsNS = (el: Node | undefined, ns: string, name?: string): Element[] => {
  const out: Element[] = [];
  if (!el) return out;
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes.item(i);
    if (isEl(c) && c.namespaceURI === ns && (!name || c.localName === name)) out.push(c);
  }
  return out;
};
const kidNS = (el: Node | undefined, ns: string, name: string) => kidsNS(el, ns, name)[0];
const at = (el: Element | undefined, name: string): string | null => (el && el.hasAttribute(name) ? el.getAttribute(name) : null);
const atn = (el: Element | undefined, name: string): number | null => {
  const v = at(el, name);
  return v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v);
};
const pt = (tw: number) => String(Math.round(tw * 5) / 100); // twips → pt, 0.01 pt precision
const EMU = 1 / 635; // twips per EMU
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isSpace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\u3000';
const isCJKish = (ch: string) => {
  const c = ch.codePointAt(0)!;
  return (c >= 0x1100 && c <= 0x11ff) || (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xff60);
};

/** Children of an element, taking the DrawingML choice of `mc:AlternateContent` and never its VML fallback. */
function* walk(el: Element): Generator<Element> {
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes.item(i);
    if (!isEl(c)) continue;
    if (c.namespaceURI === MC && c.localName === 'Fallback') continue;
    yield c;
    yield* walk(c);
  }
}

// ---------- colours ----------
interface RGBA { r: number; g: number; b: number; a: number }
const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 };
const hexColor = (s: string | null | undefined): RGBA | null =>
  s && /^[0-9a-f]{6}$/i.test(s) ? { r: parseInt(s.slice(0, 2), 16) / 255, g: parseInt(s.slice(2, 4), 16) / 255, b: parseInt(s.slice(4, 6), 16) / 255, a: 1 } : null;
const css = (c: RGBA) => '#' + [c.r, c.g, c.b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
const PRESET: Record<string, string> = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', silver: 'C0C0C0', navy: '000080' };
const ALIAS: Record<string, string> = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };
const COLOR_TAGS = new Set(['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr']);
const FILL_TAGS = new Set(['noFill', 'solidFill', 'gradFill', 'pattFill', 'blipFill', 'grpFill']);

// Office mixes colours (tint, shade) in linear light, with a plain 2.3 gamma
const GAMMA = 2.3;
const toLin = (c: RGBA): RGBA => ({ r: c.r ** GAMMA, g: c.g ** GAMMA, b: c.b ** GAMMA, a: c.a });
const fromLin = (c: RGBA): RGBA => ({ r: c.r ** (1 / GAMMA), g: c.g ** (1 / GAMMA), b: c.b ** (1 / GAMMA), a: c.a });
function toHsl({ r, g, b }: RGBA): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h: number, s: number, l: number, a: number): RGBA {
  s = Math.min(1, Math.max(0, s));
  l = Math.min(1, Math.max(0, l));
  h = ((h % 360) + 360) % 360 / 360;
  if (!s) return { r: l, g: l, b: l, a };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  return { r: f(h + 1 / 3), g: f(h), b: f(h - 1 / 3), a };
}
function transform(c: RGBA, t: Element): RGBA {
  const raw = atn(t, 'val') ?? 0;
  const v = raw / 100000;
  const hsl = (fn: (h: number, s: number, l: number) => [number, number, number]) => {
    const [h, s, l] = toHsl(c);
    const [h2, s2, l2] = fn(h, s, l);
    return fromHsl(h2, s2, l2, c.a);
  };
  switch (t.localName) {
    case 'alpha': return { ...c, a: v };
    case 'alphaMod': return { ...c, a: c.a * v };
    case 'alphaOff': return { ...c, a: Math.min(1, Math.max(0, c.a + v)) };
    case 'tint': { const l = toLin(c); return fromLin({ r: 1 - (1 - l.r) * v, g: 1 - (1 - l.g) * v, b: 1 - (1 - l.b) * v, a: c.a }); }
    case 'shade': { const l = toLin(c); return fromLin({ r: l.r * v, g: l.g * v, b: l.b * v, a: c.a }); }
    case 'satMod': return hsl((h, s, l) => [h, s * v, l]);
    case 'satOff': return hsl((h, s, l) => [h, s + v, l]);
    case 'sat': return hsl((h, _s, l) => [h, v, l]);
    case 'lumMod': return hsl((h, s, l) => [h, s, l * v]);
    case 'lumOff': return hsl((h, s, l) => [h, s, l + v]);
    case 'lum': return hsl((h, s) => [h, s, v]);
    case 'hueMod': return hsl((h, s, l) => [h * v, s, l]);
    case 'hueOff': return hsl((h, s, l) => [h + raw / 60000, s, l]);
    case 'hue': return hsl((_h, s, l) => [raw / 60000, s, l]);
    case 'comp': return hsl((h, s, l) => [h + 180, s, l]);
    case 'inv': return { r: 1 - c.r, g: 1 - c.g, b: 1 - c.b, a: c.a };
    case 'gray': { const y = 0.3 * c.r + 0.59 * c.g + 0.11 * c.b; return { r: y, g: y, b: y, a: c.a }; }
  }
  return c;
}

interface Theme { colors: Map<string, RGBA>; fills: Element[]; bgFills: Element[]; lines: Element[]; effects: Element[] }
function themeOf(xml: string | undefined, parser: Parser): Theme {
  const t: Theme = { colors: new Map(), fills: [], bgFills: [], lines: [], effects: [] };
  if (!xml) return t;
  const d = parser.parseFromString(xml, 'application/xml');
  const one = (name: string) => d.getElementsByTagNameNS(A, name).item(0) ?? undefined;
  for (const c of kidsNS(one('clrScheme'), A)) {
    const v = kidsNS(c, A)[0];
    const rgb = v?.localName === 'sysClr' ? hexColor(at(v, 'lastClr')) : hexColor(at(v, 'val'));
    if (rgb) t.colors.set(c.localName, rgb);
  }
  t.fills = kidsNS(one('fillStyleLst'), A);
  t.bgFills = kidsNS(one('bgFillStyleLst'), A);
  t.lines = kidsNS(one('lnStyleLst'), A, 'ln');
  t.effects = kidsNS(one('effectStyleLst'), A, 'effectStyle');
  return t;
}

type Paint = { kind: 'none' } | { kind: 'solid'; c: RGBA } | { kind: 'grad'; stops: { pos: number; c: RGBA }[]; ang: number };
interface Shadow { dx: number; dy: number; sd: number; c: RGBA }

// ---------- the renderer ----------
class Page {
  defs: string[] = [];
  fills: string[] = [];
  borders: string[] = [];
  content: string[] = [];
  behind: string[] = [];
  front: string[] = [];
  hits: string[] = [];
  rows: PageRow[] = [];
  cells: PageCell[] = [];
  tables: string[][] = [];
  bottom = 0;
  private ids = new Map<string, string>();

  constructor(private m: Metrics, private theme: Theme, private prefix: string) {}

  // ----- colours and paints -----
  color(el: Element | undefined, ph?: RGBA): RGBA | null {
    if (!el) return null;
    let c: RGBA | null = null;
    switch (el.localName) {
      case 'srgbClr': c = hexColor(at(el, 'val')); break;
      case 'schemeClr': {
        const v = at(el, 'val') ?? '';
        c = v === 'phClr' ? ph ?? null : this.theme.colors.get(ALIAS[v] ?? v) ?? null;
        break;
      }
      case 'sysClr': c = hexColor(at(el, 'lastClr')) ?? (at(el, 'val') === 'window' ? { r: 1, g: 1, b: 1, a: 1 } : BLACK); break;
      case 'prstClr': c = hexColor(PRESET[at(el, 'val') ?? ''] ?? '000000'); break;
      case 'scrgbClr': c = fromLin({ r: (atn(el, 'r') ?? 0) / 100000, g: (atn(el, 'g') ?? 0) / 100000, b: (atn(el, 'b') ?? 0) / 100000, a: 1 }); break;
      case 'hslClr': c = fromHsl((atn(el, 'hue') ?? 0) / 60000, (atn(el, 'sat') ?? 0) / 100000, (atn(el, 'lum') ?? 0) / 100000, 1); break;
    }
    if (!c) return null;
    for (const t of kidsNS(el, A)) c = transform(c, t);
    return c;
  }
  colorIn(el: Element | undefined, ph?: RGBA): RGBA | null {
    return this.color(kidsNS(el, A).find((c) => COLOR_TAGS.has(c.localName)), ph);
  }
  paint(el: Element | undefined, ph?: RGBA): Paint {
    if (!el) return { kind: 'none' };
    switch (el.localName) {
      case 'solidFill': { const c = this.colorIn(el, ph); return c ? { kind: 'solid', c } : { kind: 'none' }; }
      case 'gradFill': {
        const stops = kidsNS(kidNS(el, A, 'gsLst'), A, 'gs')
          .map((gs) => ({ pos: (atn(gs, 'pos') ?? 0) / 100000, c: this.colorIn(gs, ph) }))
          .filter((s): s is { pos: number; c: RGBA } => !!s.c)
          .sort((a, b) => a.pos - b.pos);
        if (!stops.length) return { kind: 'none' };
        const lin = kidNS(el, A, 'lin');
        return { kind: 'grad', stops, ang: lin ? (atn(lin, 'ang') ?? 0) / 60000 : 90 };
      }
      case 'pattFill': { const c = this.colorIn(kidNS(el, A, 'fgClr'), ph); return c ? { kind: 'solid', c } : { kind: 'none' }; }
    }
    return { kind: 'none' };
  }
  fillOf(spPr: Element | undefined, style: Element | undefined): Paint {
    const own = kidsNS(spPr, A).find((c) => FILL_TAGS.has(c.localName));
    if (own) return this.paint(own);
    const ref = kidNS(style, A, 'fillRef');
    const idx = atn(ref, 'idx') ?? 0;
    if (!idx) return { kind: 'none' };
    const el = idx >= 1001 ? this.theme.bgFills[idx - 1001] : this.theme.fills[idx - 1];
    return this.paint(el, this.colorIn(ref) ?? undefined);
  }
  lineOf(spPr: Element | undefined, style: Element | undefined): { c: RGBA; w: number } | null {
    const ln = kidNS(spPr, A, 'ln');
    const ref = kidNS(style, A, 'lnRef');
    const idx = atn(ref, 'idx') ?? 0;
    const themed = idx ? this.theme.lines[idx - 1] : undefined;
    let fill = kidsNS(ln, A).find((c) => FILL_TAGS.has(c.localName));
    let ph: RGBA | undefined;
    if (!fill && themed) {
      fill = kidsNS(themed, A).find((c) => FILL_TAGS.has(c.localName));
      ph = this.colorIn(ref) ?? undefined;
    }
    const p = this.paint(fill, ph);
    const c = p.kind === 'solid' ? p.c : p.kind === 'grad' ? p.stops[0].c : null;
    if (!c) return null;
    return { c, w: (atn(ln, 'w') ?? atn(themed, 'w') ?? 9525) * EMU };
  }
  shadowOf(spPr: Element | undefined, style: Element | undefined): Shadow | null {
    let lst = kidNS(spPr, A, 'effectLst');
    let ph: RGBA | undefined;
    if (!lst) {
      const ref = kidNS(style, A, 'effectRef');
      const idx = atn(ref, 'idx') ?? 0;
      if (!idx) return null;
      lst = kidNS(this.theme.effects[idx - 1], A, 'effectLst');
      ph = this.colorIn(ref) ?? undefined;
    }
    const sh = kidNS(lst, A, 'outerShdw');
    if (!sh) return null;
    const dist = (atn(sh, 'dist') ?? 0) * EMU, dir = ((atn(sh, 'dir') ?? 0) / 60000) * (Math.PI / 180);
    return { dx: dist * Math.cos(dir), dy: dist * Math.sin(dir), sd: ((atn(sh, 'blurRad') ?? 0) * EMU) / 2, c: this.colorIn(sh, ph) ?? { ...BLACK, a: 0.35 } };
  }
  private def(key: string, make: (id: string) => string): string {
    let id = this.ids.get(key);
    if (!id) {
      id = `${this.prefix}-${this.ids.size}`;
      this.ids.set(key, id);
      this.defs.push(make(id));
    }
    return id;
  }
  fillAttr(p: Paint): string {
    if (p.kind === 'none') return 'fill="none"';
    if (p.kind === 'solid') return `fill="${css(p.c)}"${p.c.a < 1 ? ` fill-opacity="${+p.c.a.toFixed(3)}"` : ''}`;
    const r = (p.ang * Math.PI) / 180, dx = Math.cos(r) / 2, dy = Math.sin(r) / 2;
    const stops = p.stops.map((s) => `<stop offset="${+s.pos.toFixed(4)}" stop-color="${css(s.c)}"${s.c.a < 1 ? ` stop-opacity="${+s.c.a.toFixed(3)}"` : ''}/>`).join('');
    const coords = `x1="${+(0.5 - dx).toFixed(4)}" y1="${+(0.5 - dy).toFixed(4)}" x2="${+(0.5 + dx).toFixed(4)}" y2="${+(0.5 + dy).toFixed(4)}"`;
    const id = this.def(`g:${coords}:${stops}`, (id) => `<linearGradient id="${id}" ${coords}>${stops}</linearGradient>`);
    return `fill="url(#${id})"`;
  }
  filterAttr(s: Shadow | null): string {
    if (!s) return '';
    const body = `<feDropShadow dx="${pt(s.dx)}" dy="${pt(s.dy)}" stdDeviation="${pt(s.sd)}" flood-color="${css(s.c)}" flood-opacity="${+s.c.a.toFixed(3)}"/>`;
    const id = this.def(`f:${body}`, (id) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${body}</filter>`);
    return ` filter="url(#${id})"`;
  }

  // ----- text -----
  /** Draws a paragraph whose text area starts at x and is `avail` wide; returns its height. */
  para(p: Element, x: number, y: number, avail: number, color: string, pl: ParaLayout = paraLayout(p, avail, this.m)): number {
    let ly = y + pl.before;
    const asc = ascentTw(pl.sz), desc = descentTw(pl.sz);
    pl.lines.forEach((line, k) => {
      const indent = pl.left + (k === 0 ? pl.firstExtra : 0);
      const room = avail - pl.left - pl.right - (k === 0 ? pl.firstExtra : 0);
      const slack = room - line.width;
      const jc = pl.jc;
      let off = 0;
      if (jc === 'center') off = slack / 2;
      else if (jc === 'right' || jc === 'end') off = slack;
      off = Math.max(0, off);
      // justified lines spread their slack over the gaps between characters (Korean) and the spaces
      const gs = line.glyphs;
      let lastInk = gs.length - 1;
      while (lastInk >= 0 && isSpace(gs[lastInk].ch)) lastInk--;
      const justify = slack > 0 && (jc === 'distribute' || (jc === 'both' && !line.end));
      const gap: boolean[] = gs.map((g, i) => justify && i < lastInk && (isSpace(g.ch) || isCJKish(g.ch) || isCJKish(gs[i + 1].ch)));
      const gaps = gap.filter(Boolean).length;
      const share = gaps ? slack / gaps : 0;
      const textBase = pl.exact ? ly + line.height * EXACT_BASE : ly + (line.height - asc - desc) * LEAD_ABOVE + asc;
      // a line made taller by a picture: the picture stands on the baseline, its shadow hangs below
      const baseline = line.obj && line.height > pl.pitch ? ly + line.height - line.below : textBase;
      let gx = x + indent + off;
      let chunk: { run: number; xs: number[]; text: string } | null = null;
      const flush = () => {
        if (!chunk) return;
        const run = pl.runs[chunk.run];
        const st = run.st;
        const sx = st.w / 100;
        const c = attr(kid(run.rPr, 'color'), 'val');
        const fill = c && c !== 'auto' && /^[0-9a-f]{6}$/i.test(c) ? `#${c}` : color;
        const xs = chunk.xs.map((v) => pt(v / sx)).join(' ');
        this.content.push(
          `<text x="${xs}" y="${pt(baseline)}" font-size="${st.sz / 2}"${st.bold ? ' font-weight="700"' : ''}${fill !== '#000000' ? ` fill="${fill}"` : ''}${sx !== 1 ? ` transform="scale(${sx} 1)"` : ''}>${esc(chunk.text)}</text>`,
        );
        chunk = null;
      };
      gs.forEach((g, i) => {
        if (g.obj) {
          flush();
          this.inline(g.obj, gx, baseline - ((g.h ?? 0) - (g.below ?? 0)));
        } else if (isSpace(g.ch)) flush();
        else {
          if (chunk && chunk.run !== g.run) flush();
          chunk ??= { run: g.run, xs: [], text: '' };
          chunk.xs.push(gx);
          chunk.text += g.ch;
        }
        gx += g.w + (gap[i] ? share : 0);
      });
      flush();
      ly += line.height;
    });
    this.bottom = Math.max(this.bottom, ly + pl.after);
    this.anchors(p, x, y);
    return pl.height;
  }

  // ----- drawings -----
  /** An inline drawing whose box (effects included) starts at x, top. */
  inline(d: Element, x: number, top: number) {
    const ext = kidNS(d, WP, 'extent'), eff = kidNS(d, WP, 'effectExtent');
    const r = { x: x + (atn(eff, 'l') ?? 0) * EMU, y: top + (atn(eff, 't') ?? 0) * EMU, w: (atn(ext, 'cx') ?? 0) * EMU, h: (atn(ext, 'cy') ?? 0) * EMU };
    this.graphic(d, r, this.content);
  }
  /** Floating drawings of a paragraph (text boxes beside the tables). */
  anchors(p: Element, colX: number, paraY: number) {
    for (const el of walk(p)) {
      if (el.namespaceURI !== WP || el.localName !== 'anchor') continue;
      const ext = kidNS(el, WP, 'extent');
      const w = (atn(ext, 'cx') ?? 0) * EMU, h = (atn(ext, 'cy') ?? 0) * EMU;
      const ph = kidNS(el, WP, 'positionH'), pv = kidNS(el, WP, 'positionV');
      const page = this.pageBox;
      const hFrom = at(ph, 'relativeFrom');
      const vFrom = at(pv, 'relativeFrom');
      const hBase = hFrom === 'page' || hFrom === 'leftMargin' ? 0 : hFrom === 'margin' ? page.left : colX;
      const hRoom = hFrom === 'page' ? page.w : page.w - page.left - page.right;
      const vBase = vFrom === 'page' || vFrom === 'topMargin' ? 0 : vFrom === 'margin' ? page.top : paraY;
      const vRoom = vFrom === 'page' ? page.h : page.h - page.top - page.bottom;
      const pos = (pe: Element | undefined, base: number, room: number, size: number) => {
        const o = kidNS(pe, WP, 'posOffset');
        if (o) return base + Number(o.textContent ?? 0) * EMU;
        const al = kidNS(pe, WP, 'align')?.textContent;
        return base + (al === 'center' ? (room - size) / 2 : al === 'right' || al === 'bottom' ? room - size : 0);
      };
      const simple = at(el, 'simplePos') === '1' ? kidNS(el, WP, 'simplePos') : undefined;
      const r = simple
        ? { x: (atn(simple, 'x') ?? 0) * EMU, y: (atn(simple, 'y') ?? 0) * EMU, w, h }
        : { x: pos(ph, hBase, hRoom, w), y: pos(pv, vBase, vRoom, h), w, h };
      this.graphic(el, r, at(el, 'behindDoc') === '1' ? this.behind : this.front);
    }
  }
  pageBox = { w: 11906, h: 16838, left: 1440, right: 1440, top: 1440, bottom: 1440 };

  graphic(holder: Element, r: Rect, out: string[]) {
    const data = holder.getElementsByTagNameNS(A, 'graphicData').item(0);
    if (!data) return;
    for (const c of kidsNS(data, WPG, 'wgp')) this.group(c, r, out);
    for (const c of kidsNS(data, WPS, 'wsp')) this.shape(c, r, out);
    this.bottom = Math.max(this.bottom, r.y + r.h);
  }
  /** A group: its children are placed in its own coordinates (chOff/chExt), scaled into `r`. */
  group(g: Element, r: Rect, out: string[]) {
    const xf = kidNS(kidNS(g, WPG, 'grpSpPr'), A, 'xfrm');
    const chOff = kidNS(xf, A, 'chOff'), chExt = kidNS(xf, A, 'chExt'), ext = kidNS(xf, A, 'ext');
    const cx0 = atn(chOff, 'x') ?? 0, cy0 = atn(chOff, 'y') ?? 0;
    const cw = atn(chExt, 'cx') || atn(ext, 'cx') || r.w / EMU, ch = atn(chExt, 'cy') || atn(ext, 'cy') || r.h / EMU;
    const sx = r.w / cw, sy = r.h / ch;
    const place = (x: Element | undefined): Rect => {
      const off = kidNS(x, A, 'off'), e = kidNS(x, A, 'ext');
      return { x: r.x + ((atn(off, 'x') ?? 0) - cx0) * sx, y: r.y + ((atn(off, 'y') ?? 0) - cy0) * sy, w: (atn(e, 'cx') ?? 0) * sx, h: (atn(e, 'cy') ?? 0) * sy };
    };
    for (const c of kidsNS(g, WPS, 'wsp')) this.shape(c, place(kidNS(kidNS(c, WPS, 'spPr'), A, 'xfrm')), out);
    for (const c of kidsNS(g, WPG, 'grpSp')) this.group(c, place(kidNS(kidNS(c, WPG, 'grpSpPr'), A, 'xfrm')), out);
  }
  shape(sp: Element, r: Rect, out: string[]) {
    const spPr = kidNS(sp, WPS, 'spPr');
    const style = kidNS(sp, WPS, 'style');
    const fill = this.fillAttr(this.fillOf(spPr, style));
    const line = this.lineOf(spPr, style);
    const stroke = line ? ` stroke="${css(line.c)}" stroke-width="${pt(line.w)}"${line.c.a < 1 ? ` stroke-opacity="${+line.c.a.toFixed(3)}"` : ''}` : '';
    const filter = this.filterAttr(this.shadowOf(spPr, style));
    const prst = at(kidNS(spPr, A, 'prstGeom'), 'prst') ?? 'rect';
    if (prst === 'ellipse') out.push(`<ellipse cx="${pt(r.x + r.w / 2)}" cy="${pt(r.y + r.h / 2)}" rx="${pt(r.w / 2)}" ry="${pt(r.h / 2)}" ${fill}${stroke}${filter}/>`);
    else {
      const round = prst === 'roundRect' ? ` rx="${pt(Math.min(r.w, r.h) * 0.16667)}"` : '';
      out.push(`<rect x="${pt(r.x)}" y="${pt(r.y)}" width="${pt(r.w)}" height="${pt(r.h)}"${round} ${fill}${stroke}${filter}/>`);
    }
    // text box: the text keeps its size (only the box is scaled), with the body's insets
    const content = kidNS(kidNS(sp, WPS, 'txbx'), W, 'txbxContent');
    if (!content) return;
    const body = kidNS(sp, WPS, 'bodyPr');
    const ins = (n: string, d: number) => (atn(body, n) ?? d) * EMU;
    const [l, t, rr, b] = [ins('lIns', 91440), ins('tIns', 45720), ins('rIns', 91440), ins('bIns', 45720)];
    const avail = at(body, 'wrap') === 'none' ? 1e6 : Math.max(100, r.w - l - rr);
    const fc = this.colorIn(kidNS(style, A, 'fontRef'));
    const color = fc ? css(fc) : '#000000';
    const ps = kids(content, 'p');
    const pls = ps.map((p) => paraLayout(p, avail, this.m));
    const total = pls.reduce((h, pl) => h + pl.height, 0);
    const anchor = at(body, 'anchor') ?? 't';
    let y = anchor === 'ctr' ? r.y + t + (r.h - t - b - total) / 2 : anchor === 'b' ? r.y + r.h - b - total : r.y + t;
    const saved = this.content;
    this.content = out;
    ps.forEach((p, i) => (y += this.para(p, r.x + l, y, avail, color, pls[i])));
    this.content = saved;
  }

  // ----- tables -----
  /** Draws a table whose left edge (the outside of its left border) is at x0 and top at y0; returns its height. */
  table(tbl: Element, x0: number, y0: number, svc?: { first: number; keys: string[] }, ti = -1): number {
    const box = boxOf(tbl, this.m);
    const trs = kids(tbl, 'tr');
    if (!trs.length) return 0;
    const bd = kid(kid(tbl, 'tblPr'), 'tblBorders');
    // the grid starts in the middle of the left border
    const tb0 = kid(kid(kids(trs[0], 'tc')[0], 'tcPr'), 'tcBorders');
    const left0 = borderTw(kid(tb0, 'left') ?? kid(tb0, 'start') ?? kid(bd, 'left') ?? kid(bd, 'start'));
    const gx = [x0 + left0 / 2];
    for (const w of box.grid) gx.push(gx[gx.length - 1] + w);
    const gAt = (g: number) => gx[Math.min(g, gx.length - 1)] ?? gx[0];

    interface Cell { tc: Element; row: number; g0: number; g1: number; last: number; endTc: Element; first: boolean; lastInRow: boolean }
    const grid: (Cell | undefined)[][] = trs.map(() => []);
    const cells: Cell[] = [];
    trs.forEach((tr, ri) => {
      let gi = num(kid(kid(tr, 'trPr'), 'gridBefore'), 'val') ?? 0;
      const tcs = kids(tr, 'tc');
      tcs.forEach((tc, ci) => {
        const span = num(kid(kid(tc, 'tcPr'), 'gridSpan'), 'val') ?? 1;
        const vm = kid(kid(tc, 'tcPr'), 'vMerge');
        const above = ri > 0 ? grid[ri - 1][gi] : undefined;
        if (vm && attr(vm, 'val') !== 'restart' && above) {
          above.last = ri;
          above.endTc = tc;
          for (let g = gi; g < gi + span; g++) grid[ri][g] = above;
        } else {
          const c: Cell = { tc, row: ri, g0: gi, g1: gi + span, last: ri, endTc: tc, first: ci === 0, lastInRow: ci === tcs.length - 1 };
          cells.push(c);
          for (let g = gi; g < gi + span; g++) grid[ri][g] = c;
        }
        gi += span;
      });
    });

    // row heights, the way the writer measures them; a merged cell taller than its rows stretches the last one
    const hs = trs.map((tr) => renderedHeight(tr, box));
    for (const c of cells) {
      if (c.last === c.row) continue;
      const tr = trs[c.last];
      const need = cellHeight(c.tc, gAt(c.g1) - gAt(c.g0), box) + rowExtra(tr, box) + this.rowMar(trs[c.row], box).top - this.rowMar(tr, box).top;
      const have = hs.slice(c.row, c.last + 1).reduce((a, b) => a + b, 0);
      if (need > have) hs[c.last] += need - have;
    }
    const ys = [y0 + topEdge(trs[0], box)];
    hs.forEach((h, i) => ys.push(ys[i] + h));
    // each row ends with the room for the border below it
    const rules = trs.map((tr) => gapBelow(tr, box));

    const side = (c: Cell, s: 'top' | 'bottom' | 'left' | 'right'): Element | undefined => {
      const tc = s === 'bottom' ? c.endTc : c.tc;
      const tb = kid(kid(tc, 'tcPr'), 'tcBorders');
      const own = kid(tb, s) ?? (s === 'left' ? kid(tb, 'start') : s === 'right' ? kid(tb, 'end') : undefined);
      if (own) return own;
      if (s === 'top') return kid(bd, c.row === 0 ? 'top' : 'insideH');
      if (s === 'bottom') return kid(bd, c.last === trs.length - 1 ? 'bottom' : 'insideH');
      if (s === 'left') return kid(bd, c.first ? 'left' : 'insideV') ?? (c.first ? kid(bd, 'start') : undefined);
      return kid(bd, c.lastInRow ? 'right' : 'insideV') ?? (c.lastInRow ? kid(bd, 'end') : undefined);
    };
    const bColor = (b: Element) => {
      const c = attr(b, 'color');
      return c && /^[0-9a-f]{6}$/i.test(c) ? `#${c}` : '#000000';
    };

    for (const c of cells) {
      const x = gAt(c.g0), w = gAt(c.g1) - x, top = ys[c.row], bot = ys[c.last + 1];
      // borders start where the row above ends and right under the content (a thin one leaves the rest of the room white)
      const ruleTop = c.row === 0 ? y0 : top - rules[c.row - 1];
      const ruleBot = bot - rules[c.last];
      const tcPr = kid(c.tc, 'tcPr');
      const fill = attr(kid(tcPr, 'shd'), 'fill');
      if (fill && /^[0-9a-f]{6}$/i.test(fill) && fill.toUpperCase() !== 'FFFFFF')
        this.fills.push(`<rect x="${pt(x)}" y="${pt(top)}" width="${pt(w)}" height="${pt(ruleBot - top)}" fill="#${fill}"/>`);

      // the table's outer borders are centred on the grid line, inner ones lie just left of it
      const tB = side(c, 'top'), bB = side(c, 'bottom'), lB = side(c, 'left'), rB = side(c, 'right');
      const [tt, bt, lt, rt] = [borderTw(tB), borderTw(bB), borderTw(lB), borderTw(rB)];
      const outerL = c.g0 === 0, outerR = c.g1 >= gx.length - 1;
      const lx = x - (outerL ? lt / 2 : lt), rx = x + w - (outerR ? rt / 2 : rt);
      if (tt) this.borders.push(`<rect x="${pt(lx)}" y="${pt(ruleTop)}" width="${pt(rx + rt - lx)}" height="${pt(tt)}" fill="${bColor(tB!)}"/>`);
      if (bt) this.borders.push(`<rect x="${pt(lx)}" y="${pt(ruleBot)}" width="${pt(rx + rt - lx)}" height="${pt(bt)}" fill="${bColor(bB!)}"/>`);
      if (lt) this.borders.push(`<rect x="${pt(lx)}" y="${pt(ruleTop)}" width="${pt(lt)}" height="${pt(bot - ruleTop)}" fill="${bColor(lB!)}"/>`);
      if (rt) this.borders.push(`<rect x="${pt(rx)}" y="${pt(ruleTop)}" width="${pt(rt)}" height="${pt(bot - ruleTop)}" fill="${bColor(rB!)}"/>`);

      // content: every cell gets its row's largest margins; the border below the row is not text room.
      // Lines break at the writer's measure; text keeps clear of a thick outer border.
      const mar = cellMar(c.tc, box);
      const rm = this.rowMar(trs[c.row], box), lm = this.rowMar(trs[c.last], box);
      const avail = w - mar.left - mar.right;
      const inL = Math.max(mar.left, outerL ? lt / 2 : 0), inR = Math.max(mar.right, outerR ? rt / 2 : 0);
      const ps = kids(c.tc, 'p');
      const pls = ps.map((p) => paraLayout(p, avail, this.m));
      const total = pls.reduce((h, pl) => h + pl.height, 0);
      const cTop = top + rm.top, cBot = ruleBot - lm.bottom;
      const va = attr(kid(tcPr, 'vAlign'), 'val');
      let y = va === 'center' ? cTop + (cBot - cTop - total) / 2 : va === 'bottom' ? cBot - total : cTop;
      const paras: PageCell['paras'] = [];
      ps.forEach((p, i) => {
        const dy = this.para(p, x + inL, y, w - inL - inR, '#000000', pls[i]);
        paras.push({ y: y / 20, h: dy / 20, text: textOf(p) });
        y += dy;
      });
      if (ti >= 0) this.cells.push({ table: ti, row: c.row, last: c.last, g0: c.g0, g1: c.g1, x: x / 20, y: top / 20, w: w / 20, h: (bot - top) / 20, paras });
    }
    if (ti >= 0) {
      const labels: string[] = [];
      for (const c of cells) if (c.row === 0) for (let g = c.g0; g < c.g1; g++) labels[g] = nfc(textOf(c.tc));
      this.tables[ti] = labels;
    }

    if (svc) {
      for (let i = svc.first; i < trs.length; i++) {
        const key = svc.keys[i - svc.first];
        if (key == null) continue;
        const r = { key, x: gx[0] / 20, y: ys[i] / 20, w: (gx[gx.length - 1] - gx[0]) / 20, h: hs[i] / 20 };
        this.rows.push(r);
        this.hits.push(`<rect class="hit" id="row-${esc(key)}" data-row="${esc(key)}" fill="#000" fill-opacity="0" x="${pt(gx[0])}" y="${pt(ys[i])}" width="${pt(gx[gx.length - 1] - gx[0])}" height="${pt(hs[i])}"/>`);
      }
    }
    const height = ys[ys.length - 1] - y0;
    this.bottom = Math.max(this.bottom, y0 + height);
    return height;
  }
  private rowMar(tr: Element, box: Box) {
    let top = 0, bottom = 0;
    for (const tc of kids(tr, 'tc')) {
      const m = cellMar(tc, box);
      top = Math.max(top, m.top);
      bottom = Math.max(bottom, m.bottom);
    }
    return { top, bottom };
  }
}

/** Renders the page of a finished cue sheet (from `writeDocx`'s `page`) as an SVG in points. */
export function renderPage(page: PageInput, opts: RenderOptions, parser: Parser): PageRender {
  const doc = parser.parseFromString(page.xml, 'application/xml');
  const out = new Page(page.metrics, themeOf(page.theme, parser), opts.id ?? 'cue');
  const body = kid(doc.documentElement, 'body');
  const sect = kid(body, 'sectPr');
  const pgW = num(kid(sect, 'pgSz'), 'w') ?? 11906, pgH = num(kid(sect, 'pgSz'), 'h') ?? 16838;
  const pm = kid(sect, 'pgMar');
  const mg = { top: num(pm, 'top') ?? 1440, left: num(pm, 'left') ?? 1440, right: num(pm, 'right') ?? 1440, bottom: num(pm, 'bottom') ?? 1440 };
  out.pageBox = { w: pgW, h: pgH, ...mg };
  const textW = pgW - mg.left - mg.right;

  let y = mg.top;
  let ti = 0;
  const floats: { tbl: Element; svc?: { first: number; keys: string[] }; ti: number }[] = [];
  const placeFloat = (anchorY: number) => {
    for (const { tbl, svc, ti } of floats.splice(0)) {
      const tp = kid(kid(tbl, 'tblPr'), 'tblpPr');
      const h = attr(tp, 'horzAnchor'), v = attr(tp, 'vertAnchor');
      const tx = num(tp, 'tblpX') ?? 0, ty = num(tp, 'tblpY') ?? 0;
      const x = h === 'page' ? tx : mg.left + tx;
      const top = v === 'page' ? ty : v === 'margin' ? mg.top + ty : anchorY + ty;
      out.table(tbl, x, top, svc, ti);
    }
  };
  for (const el of kids(body)) {
    if (el.localName === 'p') {
      placeFloat(y);
      y += out.para(el, mg.left, y, textW, '#000000');
    } else if (el.localName === 'tbl') {
      const i = ti++;
      const svc = i === page.rows.table ? { first: page.rows.first, keys: opts.rowKeys } : undefined;
      const tblPr = kid(el, 'tblPr');
      if (kid(tblPr, 'tblpPr')) floats.push({ tbl: el, svc, ti: i });
      else y += out.table(el, mg.left + (num(kid(tblPr, 'tblInd'), 'w') ?? 0), y, svc, i);
    }
  }
  placeFloat(y);

  const W_ = pgW / 20, H_ = pgH / 20;
  const bottom = Math.max(H_, Math.ceil(out.bottom / 20) + 2);
  const over = bottom > H_ + 2
    ? `<rect class="overflow" x="0" y="${H_}" width="${W_}" height="${bottom - H_}"/><line class="page-end" x1="0" x2="${W_}" y1="${H_}" y2="${H_}"/>`
    : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" class="cue-page" viewBox="0 0 ${W_} ${bottom}" width="${W_}pt" height="${bottom}pt" style="font-family:${FONT}" text-rendering="geometricPrecision">` +
    `<defs>${out.defs.join('')}</defs>` +
    `<rect class="sheet" x="0" y="0" width="${W_}" height="${H_}" fill="#fff"/>` +
    over +
    `<g class="behind">${out.behind.join('')}</g>` +
    `<g class="fills">${out.fills.join('')}</g>` +
    `<g class="borders">${out.borders.join('')}</g>` +
    `<g class="text">${out.content.join('')}</g>` +
    `<g class="front">${out.front.join('')}</g>` +
    `<g class="hits">${out.hits.join('')}</g>` +
    `</svg>`;
  return { svg, width: W_, height: H_, bottom: out.bottom / 20, viewHeight: bottom, rows: out.rows, cells: out.cells, tables: out.tables, timeline: page.rows };
}
