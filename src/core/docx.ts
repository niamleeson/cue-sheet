import JSZip from 'jszip';
import { COLS } from './types';
import type { Col, OutLine, Sheet } from './types';
import {
  W, all, attr, boxOf, cellBorder, cellWidths, contentHeight, isEl, isMerged, kid, kids, metricsOf, nfc, num, paraHeight, renderedHeight,
  rowExtra, styleOf, tableHeight, textArea, textOf, textWidth, topEdge,
} from './layout';
import type { Metrics, Style } from './layout';

export { W };

/**
 * Fills a Word cue sheet from a template: any earlier cue sheet of the same service works.
 * Title, date, header (staff, cast, mics, videos), rehearsal and service rows are rewritten;
 * everything else (page setup, stage diagram, styles, fonts) is kept as is.
 * New rows copy the template's own formatting (the most common format of each column).
 * No comments are ever added; comments, highlights, red text and tracked changes left in
 * the template are removed.
 */

const XML_NS = 'http://www.w3.org/XML/1998/namespace';

export interface XmlImpl {
  DOMParser: new () => { parseFromString(s: string, type: string): Document };
  XMLSerializer: new () => { serializeToString(n: Node): string };
}

/** What the page preview draws: the finished document and the parts of the package it needs. */
export interface PageData {
  /** word/document.xml, exactly as saved */
  xml: string;
  /** word/theme/theme1.xml (colors and shape styles of the stage diagram) */
  theme?: string;
  metrics: Metrics;
  /** which body table holds the service rows, and the index of its first service row */
  rows: { table: number; first: number };
}

export interface DocxResult {
  bytes: Uint8Array;
  warnings: string[];
  /** twips: rows' natural total, template rows' total, room on the page, where the rows start */
  fit: { natural: number; template: number; capacity: number; top: number };
  page: PageData;
}

export class TemplateError extends Error {}


function mk(doc: Document, name: string, attrs: Record<string, string> = {}): Element {
  const e = doc.createElementNS(W, 'w:' + name);
  for (const [k, v] of Object.entries(attrs)) e.setAttributeNS(W, 'w:' + k, v);
  return e;
}
function removeChildren(el: Element, keep: (c: Element) => boolean = () => false) {
  for (let i = el.childNodes.length - 1; i >= 0; i--) {
    const c = el.childNodes.item(i);
    if (!(isEl(c) && keep(c))) el.removeChild(c);
  }
}
/** Replace or insert child `name`, keeping the schema's element order. */
function setChild(doc: Document, parent: Element, name: string, attrs: Record<string, string>, order: string[]): Element {
  for (const c of kids(parent, name)) parent.removeChild(c);
  const e = mk(doc, name, attrs);
  const at = order.indexOf(name);
  const ref = kids(parent).find((c) => order.indexOf(c.localName) > at) ?? null;
  parent.insertBefore(e, ref);
  return e;
}
const RPR_ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'];
const PPR_ORDER = ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'];
const TCPR_ORDER = ['cnfStyle', 'tcW', 'gridSpan', 'hMerge', 'vMerge', 'tcBorders', 'shd', 'noWrap', 'tcMar', 'textDirection', 'tcFitText', 'vAlign', 'hideMark', 'headers', 'cellIns', 'cellDel', 'cellMerge', 'tcPrChange'];
const BORDER_ORDER = ['top', 'start', 'left', 'bottom', 'end', 'right', 'insideH', 'insideV', 'tl2br', 'tr2bl'];

/**
 * Gives the sheet's last row the bottom borders of the template's last row, so the table closes
 * the way the church's sheets do (on the thick table border, not a copied thin row rule).
 */
function closeLike(doc: Document, tr: Element, tpl: Element) {
  const tcs = kids(tr, 'tc'), tpls = kids(tpl, 'tc');
  tcs.forEach((tc, i) => {
    const tcPr = kid(tc, 'tcPr');
    const want = tpls.length === tcs.length ? cellBorder(tpls[i], 'bottom') : undefined;
    let tb = kid(tcPr, 'tcBorders');
    for (const b of kids(tb, 'bottom')) tb!.removeChild(b);
    if (want && tcPr) {
      tb ??= setChild(doc, tcPr, 'tcBorders', {}, TCPR_ORDER);
      const at = BORDER_ORDER.indexOf('bottom');
      tb.insertBefore(want.cloneNode(true), kids(tb).find((c) => BORDER_ORDER.indexOf(c.localName) > at) ?? null);
    } else if (tb && tcPr && !kids(tb).length) tcPr.removeChild(tb);
  });
}
const REVISION = new Set(['rPrChange', 'pPrChange', 'ins', 'del', 'moveFrom', 'moveTo']);

/** Sets the row height Word starts from (margins and borders come on top). */
function setHeight(doc: Document, tr: Element, h: number) {
  let trPr = kid(tr, 'trPr');
  if (!trPr) { trPr = mk(doc, 'trPr'); tr.insertBefore(trPr, tr.firstChild); }
  let th = kid(trPr, 'trHeight');
  if (!th) { th = mk(doc, 'trHeight'); trPr.appendChild(th); }
  th.setAttributeNS(W, 'w:val', String(Math.round(h)));
  if (th.hasAttributeNS(W, 'hRule')) th.removeAttributeNS(W, 'hRule'); // "at least": Word grows the row if needed
}

// ---------- run / paragraph formatting ----------
function cleanRPr(rPr: Element) {
  for (const c of kids(rPr)) {
    const n = c.localName;
    if (n === 'highlight' || n === 'shd' || REVISION.has(n)) rPr.removeChild(c);
    else if (n === 'color' && /^(ff0000|red)$/i.test(attr(c, 'val') ?? '')) {
      c.setAttributeNS(W, 'w:val', '000000');
      for (const a of ['themeColor', 'themeShade', 'themeTint']) if (c.hasAttributeNS(W, a)) c.removeAttributeNS(W, a);
    }
  }
}
function cleanPPr(pPr: Element) {
  for (const c of kids(pPr)) if (REVISION.has(c.localName)) pPr.removeChild(c);
  const r = kid(pPr, 'rPr');
  if (r) cleanRPr(r);
}
function setBold(doc: Document, rPr: Element, bold: boolean) {
  for (const c of kids(rPr)) if (c.localName === 'b' || c.localName === 'bCs') rPr.removeChild(c);
  if (bold) { setChild(doc, rPr, 'b', {}, RPR_ORDER); setChild(doc, rPr, 'bCs', {}, RPR_ORDER); }
}
/** The most representative run formatting of a paragraph: the run with the most text. */
function runPr(p: Element): Element | undefined {
  let best: Element | undefined, len = -1;
  for (const r of kids(p, 'r')) {
    const l = textOf(r).length;
    if (kid(r, 'rPr') && l > len) { best = kid(r, 'rPr'); len = l; }
  }
  return best ?? kid(kid(p, 'pPr'), 'rPr');
}

/** Item-aware split for narrow cells: never between a label and "Mic", "#1-4", "65%" … */
const breakable = (word: string) => !!word && !/^[\d#%(+]/.test(word) && !/^mic$/i.test(word);
function splitItems(text: string, st: Style, avail: number, m: Metrics): string[] | null {
  const parts: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
    if (!cur) { cur = word; continue; }
    if (textWidth(cur + ' ' + word, st, m) <= avail || !breakable(word)) cur += ' ' + word;
    else { parts.push(cur); cur = word; }
  }
  parts.push(cur);
  return parts.length > 1 && parts.every((p) => textWidth(p, st, m) <= avail) ? parts : null;
}
/** Short labels (mics, lights, roles…) stay on one line: shrink a little, else break between items. */
function fitLabel(text: string, st: Style, avail: number, m: Metrics): { st: Style; parts: string[] } {
  const cands: Style[] = [];
  const add = (sz: number, w: number) => { if (sz >= 10 && !cands.some((c) => c.sz === sz && c.w === w)) cands.push({ ...st, sz, w }); };
  add(st.sz, st.w); add(st.sz - 1, st.w); add(st.sz - 1, Math.min(st.w, 90)); add(st.sz - 2, Math.min(st.w, 90));
  for (const c of cands) if (textWidth(text, c, m) <= avail) return { st: c, parts: [text] };
  for (const c of cands) { const parts = splitItems(text, c, avail, m); if (parts) return { st: c, parts }; }
  return { st: cands[cands.length - 1], parts: [text] };
}

/** `fit` needs `avail` (the cell's text width) and the document's metrics `m`. */
interface ParaOpts { avail?: number; fit?: boolean; left?: boolean; m?: Metrics }
function makePara(doc: Document, proto: Element, line: OutLine | null, o: ParaOpts = {}): Element {
  const p = mk(doc, 'p');
  const pPr0 = kid(proto, 'pPr');
  const pPr = pPr0 ? (pPr0.cloneNode(true) as Element) : mk(doc, 'pPr');
  cleanPPr(pPr);
  if (o.left && !/^(left|start|center|right|end)$/.test(attr(kid(pPr, 'jc'), 'val') ?? '')) setChild(doc, pPr, 'jc', { val: 'left' }, PPR_ORDER);
  if (kids(pPr).length) p.appendChild(pPr);
  if (!line || !line.text) return p;
  const base = runPr(proto);
  const rPr = base ? (base.cloneNode(true) as Element) : mk(doc, 'rPr');
  cleanRPr(rPr);
  setBold(doc, rPr, !!line.bold);
  let parts = [line.text];
  if (o.fit && o.avail && o.m) {
    const ind = kid(pPr, 'ind');
    const avail = (o.avail - (num(ind, 'left') ?? 0) - (num(ind, 'right') ?? 0) - Math.max(0, (num(ind, 'firstLine') ?? 0) - (num(ind, 'hanging') ?? 0))) * 0.985;
    const st = styleOf(rPr);
    const f = fitLabel(line.text, st, avail, o.m);
    parts = f.parts;
    if (f.st.sz !== st.sz) {
      setChild(doc, rPr, 'sz', { val: String(f.st.sz) }, RPR_ORDER);
      if (kid(rPr, 'szCs')) setChild(doc, rPr, 'szCs', { val: String(f.st.sz) }, RPR_ORDER);
    }
    if (f.st.w !== st.w) setChild(doc, rPr, 'w', { val: String(f.st.w) }, RPR_ORDER);
  }
  const r = mk(doc, 'r');
  r.appendChild(rPr);
  parts.forEach((s, i) => {
    if (i) r.appendChild(mk(doc, 'br'));
    const t = mk(doc, 't');
    if (/^\s|\s$/.test(s)) t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    t.appendChild(doc.createTextNode(s));
    r.appendChild(t);
  });
  p.appendChild(r);
  return p;
}
interface Protos { first: Element; rest: Element }
function fillCell(doc: Document, tc: Element, lines: OutLine[], protos: Protos, o: ParaOpts = {}) {
  removeChildren(tc, (c) => c.namespaceURI === W && c.localName === 'tcPr');
  const ls: (OutLine | null)[] = lines.length ? lines : [null];
  ls.forEach((l, i) => tc.appendChild(makePara(doc, i === 0 ? protos.first : protos.rest, l, o)));
}
/** Prototypes from one cell's own paragraphs (rehearsal / header cells). */
function protosFrom(tc: Element, titleLike = false): Protos | null {
  const ps = kids(tc, 'p');
  const full = ps.filter((p) => textOf(p).trim());
  const first = full[0] ?? ps[0];
  if (!first) return null;
  return { first, rest: titleLike ? full[1] ?? first : first };
}
function sig(p: Element): string {
  const pPr = kid(p, 'pPr');
  const parts: string[] = [];
  for (const n of ['jc', 'ind', 'spacing']) {
    const e = kid(pPr, n);
    if (!e) continue;
    const as: string[] = [];
    for (let i = 0; i < e.attributes.length; i++) { const a = e.attributes.item(i)!; as.push(`${a.localName}=${a.value}`); }
    parts.push(`${n}:${as.sort().join(',')}`);
  }
  const st = styleOf(runPr(p));
  parts.push(`${st.sz}/${st.w}`);
  return parts.join('|');
}
/** The paragraph whose formatting is most common among `ps`. */
function modeProto(ps: Element[]): Element | undefined {
  const count = new Map<string, { n: number; p: Element }>();
  for (const p of ps) {
    const s = sig(p);
    const c = count.get(s);
    if (c) c.n++; else count.set(s, { n: 1, p });
  }
  let best: { n: number; p: Element } | undefined;
  for (const v of count.values()) if (!best || v.n > best.n) best = v;
  return best?.p;
}

// ---------- comments ----------
async function stripComments(zip: JSZip, doc: Document) {
  for (const n of ['commentRangeStart', 'commentRangeEnd']) for (const e of all(doc, n)) e.parentNode?.removeChild(e);
  for (const e of all(doc, 'commentReference')) {
    const run = e.parentNode as Element;
    run.parentNode?.removeChild(run);
  }
  const parts = Object.keys(zip.files).filter((n) => /^word\/comments[A-Za-z]*\.xml$/.test(n));
  if (!parts.length) return;
  for (const n of parts) zip.remove(n);
  const relsPath = 'word/_rels/document.xml.rels';
  const rels = await zip.file(relsPath)?.async('string');
  if (rels) zip.file(relsPath, rels.replace(/<Relationship\b[^>]*Target="comments[A-Za-z]*\.xml"[^>]*\/>/g, ''));
  const ct = await zip.file('[Content_Types].xml')?.async('string');
  if (ct) zip.file('[Content_Types].xml', ct.replace(/<Override\b[^>]*PartName="\/word\/comments[A-Za-z]*\.xml"[^>]*\/>/g, ''));
}

// ---------- main ----------
const TIMELINE_LABELS: Record<string, 'time' | Col> = {
  시간: 'time', 내용: 'content', 담당: 'role', 음향: 'mic', 화면: 'screen', 조명: 'light', '입-출': 'inout', 입출: 'inout', 무대: 'stage', 세부사항: 'details',
};
const HEADER_LABELS: Record<string, 'staff' | 'cast' | 'check'> = { 프로그램진행: 'staff', 출연: 'cast', 체크사항: 'check' };
const NARROW = new Set<'time' | Col>(['time', 'role', 'mic', 'screen', 'light', 'inout', 'stage']);
const SAFETY = 200; // twips kept free at the bottom of the page

export async function writeDocx(template: ArrayBuffer | Uint8Array, sheet: Sheet, xml: XmlImpl = globalThis as unknown as XmlImpl): Promise<DocxResult> {
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(template);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new TemplateError('Word 문서(.docx)가 아닙니다');
  const doc = new xml.DOMParser().parseFromString(await docFile.async('string'), 'application/xml');
  const body = kid(doc.documentElement, 'body');
  if (!body) throw new TemplateError('문서 본문을 찾을 수 없습니다');
  await stripComments(zip, doc);
  const metrics = metricsOf(await zip.file('word/styles.xml')?.async('string'), await zip.file('word/settings.xml')?.async('string'));

  const tables = kids(body, 'tbl');
  const firstRowHas = (t: Element, label: string) => { const r0 = kids(t, 'tr')[0]; return !!r0 && kids(r0, 'tc').some((c) => nfc(textOf(c)) === label); };
  const timeline = tables.find((t) => firstRowHas(t, '세부사항'));
  const header = tables.find((t) => t !== timeline && firstRowHas(t, '체크사항'));
  if (!timeline) throw new TemplateError('서식에서 큐시트 표(시간·내용·…·세부사항)를 찾을 수 없습니다');

  // title and date
  const paras = kids(body, 'p');
  const titleP = paras.find((p) => /cue-?sheet/i.test(textOf(p)));
  if (!titleP) warnings.push('서식에서 제목(…Cue-Sheet)을 찾지 못해 제목을 바꾸지 않았습니다');
  else if (textOf(titleP).trim() !== sheet.title) {
    const runs = kids(titleP, 'r').filter((r) => kid(r, 't'));
    const t = kid(runs[0], 't')!;
    removeChildren(t);
    t.appendChild(doc.createTextNode(sheet.title));
    runs.slice(1).forEach((r) => titleP.removeChild(r));
  }
  const dateP = paras.find((p) => p !== titleP && /\d{4}\s*년/.test(textOf(p)));
  if (!dateP) warnings.push('서식에서 날짜(YYYY년 M월 D일)를 찾지 못해 날짜를 바꾸지 않았습니다');
  else {
    const runs = kids(dateP, 'r');
    const i = runs.findIndex((r) => /\d/.test(textOf(r)));
    const t = kid(runs[i], 't')!;
    removeChildren(t);
    t.appendChild(doc.createTextNode(sheet.dateText));
    runs.slice(i + 1).forEach((r) => dateP.removeChild(r));
    for (const n of ['proofErr', 'bookmarkStart', 'bookmarkEnd']) kids(dateP, n).forEach((e) => dateP.removeChild(e));
  }

  // header table
  if (!header) warnings.push('서식에서 머리 표(프로그램 진행·출연·체크사항)를 찾지 못했습니다');
  else {
    const [h0, h1] = kids(header, 'tr');
    const idx: Partial<Record<'staff' | 'cast' | 'check', number>> = {};
    kids(h0, 'tc').forEach((c, i) => { const k = HEADER_LABELS[nfc(textOf(c))]; if (k) idx[k] = i; });
    const cells = h1 ? kids(h1, 'tc') : [];
    const fillSimple = (k: 'staff' | 'cast', lines: string[]) => {
      const tc = idx[k] != null ? cells[idx[k]!] : undefined;
      const pr = tc && protosFrom(tc);
      if (!tc || !pr) { warnings.push(`머리 표의 ${k === 'staff' ? '프로그램 진행' : '출연'} 칸을 찾지 못했습니다`); return; }
      fillCell(doc, tc, lines.map((text) => ({ text })), pr);
    };
    fillSimple('staff', sheet.header.staff);
    fillSimple('cast', sheet.header.cast);
    const tc = idx.check != null ? cells[idx.check] : undefined;
    if (!tc) warnings.push('머리 표의 체크사항 칸을 찾지 못했습니다');
    else {
      const ps = kids(tc, 'p');
      const tx = (p: Element | undefined) => (p ? textOf(p) : '');
      const hi = ps.findIndex((p) => tx(p).trim().startsWith('■음향'));
      const vi = ps.findIndex((p) => tx(p).trim().startsWith('■영상'));
      const headP = ps[hi] ?? ps[0];
      const micP = ps.find((p, j) => j > hi && j !== vi && tx(p).trim() && !tx(p).trim().startsWith('■')) ?? headP;
      const vidP = ps[vi] ?? headP;
      const contP = vi >= 0 && tx(ps[vi + 1]).trim() ? ps[vi + 1] : micP;
      const prefix = vi >= 0 ? (/^■영상\s*:\s*/.exec(tx(vidP).trimStart())?.[0] ?? '■영상: ') : '■영상: ';
      const indent = contP !== micP ? (/^\s*/.exec(tx(contP))?.[0] ?? '') : '';
      removeChildren(tc, (c) => c.namespaceURI === W && c.localName === 'tcPr');
      tc.appendChild(makePara(doc, headP, { text: tx(headP).trim().startsWith('■음향') ? tx(headP).trim() : '■음향:' }));
      for (const m of sheet.header.mics) tc.appendChild(makePara(doc, micP, { text: m }));
      sheet.header.videos.forEach((v, i) => tc.appendChild(makePara(doc, i === 0 ? vidP : contP, { text: i === 0 ? prefix + v : indent + v })));
    }
  }

  // timeline structure
  const rows = kids(timeline, 'tr');
  const colOf: ('time' | Col)[] = kids(rows[0], 'tc').map((c) => TIMELINE_LABELS[nfc(textOf(c))]);
  const expected = ['time', ...COLS];
  if (colOf.length !== expected.length || colOf.some((c, i) => c !== expected[i]))
    throw new TemplateError(`서식의 큐시트 표 칸이 다릅니다 (${kids(rows[0], 'tc').map((c) => textOf(c)).join(', ')})`);
  const box = boxOf(timeline, metrics);
  const firstCell = (tr: Element) => kids(tr, 'tc')[0];
  const vm = (tr: Element) => kid(kid(firstCell(tr), 'tcPr'), 'vMerge');
  let ri = 1;
  const reh: Element[] = [];
  if (rows[ri] && attr(vm(rows[ri]), 'val') === 'restart') {
    reh.push(rows[ri++]);
    while (rows[ri] && vm(rows[ri]) && attr(vm(rows[ri]), 'val') !== 'restart') reh.push(rows[ri++]);
  }
  const svcRows = rows.slice(ri);
  if (!svcRows.length) throw new TemplateError('서식의 큐시트 표에 순서 행이 없습니다');
  const templateTotal = svcRows.reduce((h, r) => h + renderedHeight(r, box), 0);

  // rehearsal: fill in place
  if (reh.length) {
    const rc = sheet.rehearsal.cells;
    const top = kids(reh[0], 'tc');
    const ws = cellWidths(reh[0], box);
    const linesFor = (col: 'time' | Col): OutLine[] =>
      col === 'time' ? sheet.rehearsal.time.map((text) => ({ text })) : col === 'light' ? rc.lightA ?? rc.light ?? [] : rc[col] ?? [];
    top.forEach((tc, i) => {
      const pr = protosFrom(tc, colOf[i] === 'content');
      if (pr) fillCell(doc, tc, linesFor(colOf[i]), pr, { avail: textArea(tc, ws[i], box), fit: NARROW.has(colOf[i]), left: !NARROW.has(colOf[i]), m: metrics });
    });
    const li = colOf.indexOf('light');
    const lowTc = reh[1] ? kids(reh[1], 'tc')[li] : undefined;
    if (lowTc && rc.lightB && !isMerged(lowTc)) {
      const pr = protosFrom(lowTc) ?? protosFrom(top[li]);
      if (pr) fillCell(doc, lowTc, rc.lightB, pr, { avail: textArea(lowTc, cellWidths(reh[1], box)[li], box), fit: true, m: metrics });
    }
    // the merged cells span every rehearsal row: grow the first row if they need more room
    // (their margins are already part of the first row's own padding)
    const lower = reh.slice(1).reduce((h, r) => h + renderedHeight(r, box), 0);
    const need = Math.max(contentHeight(reh[0], box, true), contentHeight(reh[0], box) - lower);
    if (need > (num(kid(kid(reh[0], 'trPr'), 'trHeight'), 'val') ?? 0)) setHeight(doc, reh[0], need);
  }

  // service rows: rebuilt from the template's most common formats
  const fillOf = (tc: Element) => (attr(kid(kid(tc, 'tcPr'), 'shd'), 'fill') ?? 'auto').toUpperCase();
  const regular = svcRows.filter((r) => kids(r, 'tc').length === colOf.length);
  if (!regular.length) throw new TemplateError('서식의 순서 행이 머리 칸과 맞지 않습니다');
  const plain = regular.filter((r) => kids(r, 'tc').every((tc) => !isMerged(tc) && /^(AUTO|FFFFFF)$/.test(fillOf(tc))));
  const pool = plain.length ? plain : regular;
  const protoRow = pool[Math.floor(pool.length / 2)];
  const protoCells = kids(protoRow, 'tc');
  const colProtos: Protos[] = colOf.map((c, i) => {
    const ps = regular.flatMap((r) => kids(kids(r, 'tc')[i], 'p').filter((p) => textOf(p).trim()));
    const any = kids(protoCells[i], 'p')[0];
    if (c === 'content') {
      const first = modeProto(ps.filter((p) => textOf(p).trim().startsWith('▶'))) ?? modeProto(ps) ?? any;
      const rest = modeProto(ps.filter((p) => !textOf(p).trim().startsWith('▶'))) ?? first;
      return { first, rest };
    }
    const m = modeProto(ps) ?? any;
    return { first: m, rest: m };
  });
  if (colProtos.some((p) => !p.first)) throw new TemplateError('서식의 순서 행 서식을 읽을 수 없습니다');
  for (const r of svcRows) timeline.removeChild(r);
  const built: Element[] = [];
  const ws = cellWidths(protoRow, box);
  for (const row of sheet.rows) {
    const tr = mk(doc, 'tr');
    const trPr = kid(protoRow, 'trPr');
    if (trPr) tr.appendChild(trPr.cloneNode(true));
    colOf.forEach((col, i) => {
      const tc = mk(doc, 'tc');
      const tcPr = (kid(protoCells[i], 'tcPr')?.cloneNode(true) as Element | undefined) ?? mk(doc, 'tcPr');
      for (const c of kids(tcPr)) if (c.localName === 'vMerge' || c.localName === 'shd' || REVISION.has(c.localName)) tcPr.removeChild(c);
      if (row.shade) setChild(doc, tcPr, 'shd', { val: 'clear', color: 'auto', fill: row.shade }, TCPR_ORDER);
      tc.appendChild(tcPr);
      const lines = col === 'time' ? row.time.map((text) => ({ text })) : row.cells[col];
      fillCell(doc, tc, lines, colProtos[i], { avail: textArea(tc, ws[i], box), fit: NARROW.has(col), left: !NARROW.has(col), m: metrics });
      tr.appendChild(tc);
    });
    timeline.appendChild(tr);
    built.push(tr);
  }
  if (built.length) closeLike(doc, built[built.length - 1], svcRows[svcRows.length - 1]);

  // page fit: where the service rows start, and how much room is left below
  const sect = kid(body, 'sectPr');
  const pgW = num(kid(sect, 'pgSz'), 'w') ?? 11906;
  const pgH = num(kid(sect, 'pgSz'), 'h') ?? 16838;
  const pm = kid(sect, 'pgMar');
  const [mTop, mBottom] = [num(pm, 'top') ?? 1440, num(pm, 'bottom') ?? 1440];
  const textW = pgW - (num(pm, 'left') ?? 1440) - (num(pm, 'right') ?? 1440);
  let y = mTop;
  for (const el of kids(body)) {
    if (el === timeline) break;
    if (el.localName === 'p') y += paraHeight(el, textW, metrics);
    else if (el.localName === 'tbl' && !kid(kid(el, 'tblPr'), 'tblpPr')) y += tableHeight(el, boxOf(el, metrics));
  }
  const tp = kid(kid(timeline, 'tblPr'), 'tblpPr');
  const anchor = attr(tp, 'vertAnchor');
  const ty = num(tp, 'tblpY') ?? 0;
  let top = !tp ? y : anchor === 'page' ? ty : anchor === 'margin' ? mTop + ty : y + ty;
  top += topEdge(rows[0], box) + renderedHeight(rows[0], box) + reh.reduce((h, r) => h + renderedHeight(r, box), 0);
  // the last row's height already includes the table's bottom border
  const capacity = Math.max(0, pgH - mBottom - top - SAFETY);

  // rows grow evenly to the template's length (or the page), the way the church's sheets look
  const inner = built.map((tr) => contentHeight(tr, box));
  const extra = built.map((tr) => rowExtra(tr, box));
  const innerTotal = inner.reduce((a, b) => a + b, 0);
  const extraTotal = extra.reduce((a, b) => a + b, 0);
  const naturalTotal = innerTotal + extraTotal;
  const target = Math.min(templateTotal, capacity);
  const scale = innerTotal > 0 && naturalTotal < target ? Math.min((target - extraTotal) / innerTotal, 2) : 1;
  built.forEach((tr, i) => setHeight(doc, tr, inner[i] * scale));
  if (naturalTotal > capacity)
    warnings.push(`내용이 한 페이지를 넘을 수 있습니다 (예상 ${Math.round((naturalTotal / capacity) * 100)}%) — 줄이 긴 칸을 줄이거나 Word에서 확인하세요`);

  let out = new xml.XMLSerializer().serializeToString(doc);
  if (!out.startsWith('<?xml')) out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + out;
  zip.file('word/document.xml', out);
  const theme = await zip.file('word/theme/theme1.xml')?.async('string');
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return {
    bytes,
    warnings,
    fit: { natural: naturalTotal, template: templateTotal, capacity, top },
    page: { xml: out, theme, metrics, rows: { table: tables.indexOf(timeline), first: ri } },
  };
}
