/**
 * Saving a cell typed in the preview. The typed lines are tidied (autoformat) and written back where they came from:
 * list items (찬양, 본문, 설교제목 …), fill-in values (봉헌위원 …), the singer/leader count, people in the header,
 * durations and the start time. Whatever the data cannot explain is kept as line changes on the cell (CellEdit):
 * the 변경 사항 (고급) list, saved with the document.
 */
import { COMPUTED, TOKEN, buildDoc, buildSheet, fmtMin, toMin } from './engine';
import { clone, docServices, fieldValue, newId } from './doc';
import type { FieldKind } from './doc';
import { applyOps, lineKey } from './lineops';
import { writeField as typeField, writeFieldFor } from './ops';
import { COLS } from './types';
import type { CellEdit, Col, CueDoc, EditCol, LineOp, OutLine, RulesFile, Sheet } from './types';

// ---------------- cells ----------------

/** The lines of a cell in a finished sheet; null when the sheet has no such cell. */
export function cellLines(sheet: Sheet, row: string, col: EditCol): OutLine[] | null {
  const plain = (ts: string[]) => ts.map((text) => ({ text }));
  if (row === 'header') {
    const h = sheet.header[col as keyof Sheet['header']];
    return h ? plain(h) : null;
  }
  if (row === 'rehearsal') return col === 'time' ? plain(sheet.rehearsal.time) : sheet.rehearsal.cells[col] ?? null;
  const r = sheet.rows.find((x) => x.key === row);
  if (!r) return null;
  if (col === 'time') return plain(r.time);
  return (COLS as readonly string[]).includes(col) && sheet.cols.includes(col as Col) ? r.cells[col as Col] : null;
}

export const cellText = (ls: OutLine[] | null) => (ls ?? []).map((l) => l.text).join('\n');

/** Cells that only ever change their own service: times and the people in the header. */
export const ownOnly = (row: string, col: EditCol) => col === 'time' || (row === 'header' && (col === 'staff' || col === 'cast'));

/**
 * The other services a cell change can also go to (다른 예배에도 적용): services whose sheet has the cell, and whether it
 * reads the same there now. A change goes to this service only unless others are picked.
 */
export function scopeChoices(sheets: Sheet[], sid: string, row: string, col: EditCol): { sid: string; label: string; same: boolean }[] {
  const mine = sheets.find((sh) => sh.serviceId === sid);
  if (!mine || ownOnly(row, col)) return [];
  const text = cellText(cellLines(mine, row, col));
  return sheets
    .filter((sh) => sh.serviceId !== sid && cellLines(sh, row, col) != null)
    .map((sh) => ({ sid: sh.serviceId, label: sh.label, same: cellText(cellLines(sh, row, col)) === text }));
}

/** Edits of this cell that the service shows. */
export const cellEdits = (doc: CueDoc, sid: string, row: string, col: EditCol) =>
  doc.edits.filter((e) => e.row === row && e.col === col && e.services.includes(sid));

/** Edits of another cell in the row that also change this one (담당 변경 → Mic, 세부사항). */
export const linkedEdits = (doc: CueDoc, sid: string, row: string, col: EditCol) =>
  doc.edits.filter((e) => e.row === row && e.col !== col && e.services.includes(sid) && e.also?.some((a) => a.col === col));

/**
 * What a 담당 change (사회자 → 설교자) also changes in its row: the Mic (to the new person's Mic in this service) and the
 * names in 세부사항 — only where the cell has them now, so a change that later finds nothing means the cell changed.
 */
export function roleLinks(rules: RulesFile, sheet: Sheet, row: string, swaps: { from: string; to: string }[]): NonNullable<CellEdit['also']> {
  const rm = rules.services[sheet.serviceId].roleMics;
  const fits = (col: EditCol, op: LineOp) => {
    const ls = cellLines(sheet, row, col);
    return !!ls && applyOps(ls, [op]).ok;
  };
  const sub = (from: string, to: string) => ({ op: 'sub' as const, from, to });
  const mic = swaps.filter((w) => rm[w.from] && rm[w.to] && rm[w.from] !== rm[w.to]).map((w) => sub(rm[w.from], rm[w.to])).filter((o) => fits('mic', o));
  const details = swaps.map((w) => sub(w.from, w.to)).filter((o) => fits('details', o));
  return [...(mic.length ? [{ col: 'mic' as const, ops: mic }] : []), ...(details.length ? [{ col: 'details' as const, ops: details }] : [])];
}

// ---------------- autoformat ----------------

/** lines that already carry their own mark */
const MARKED = /^[-(*※■▶[]/;

function formatTime(l: string): string {
  let m = /^(\*)?\s*(\d{1,2})\s*[:：]\s*(\d{2})$/.exec(l);
  if (m) return `${m[1] ?? ''}${fmtMin(Number(m[2]) * 60 + Number(m[3]))}`;
  m = /^\(?\s*(\d{1,3})\s*(?:[’'′`]|분)?\s*\)?$/.exec(l);
  if (m) return `(${Number(m[1])}’)`;
  return l;
}

function formatLine(col: EditCol, l: string, i: number): string {
  switch (col) {
    case 'details':
      return /^-\s+/.test(l) ? '-' + l.replace(/^-\s+/, '') : MARKED.test(l) ? l : '-' + l;
    case 'content':
      if (l.startsWith('▶')) return '▶' + l.slice(1).trimStart();
      if (/^\d+\s*[.)]\s*/.test(l)) return l.replace(/^(\d+)\s*([.)])\s*/, '$1$2 ');
      if (i === 0) return l;
      if (/^-(?=\S)/.test(l)) return '- ' + l.slice(1);
      return MARKED.test(l) ? l : '- ' + l;
    case 'mic':
    case 'mics':
      return l.replace(/\bmic\b/gi, 'Mic').replace(/#\s*(\d+)\s*-\s*(\d+)/g, '#$1-$2');
    case 'light':
    case 'lightA':
    case 'lightB':
      return l.replace(/(\d)\s+%/g, '$1%');
    case 'time':
      return formatTime(l);
    case 'staff': {
      const m = /^-?\s*([^:：■]+?)\s*[:：]\s*(.*)$/.exec(l);
      return m ? `-${m[1]}: ${m[2]}`.trimEnd() : l;
    }
    case 'cast': {
      const m = /^■?\s*([^:：■]+?)\s*[:：]\s*(.*)$/.exec(l);
      return m ? `■${m[1]}: ${m[2]}`.trimEnd() : l;
    }
    default:
      return l;
  }
}

/** cells whose every line is generated in one style: typed lines are put in it right away */
const GENERATED = new Set<EditCol>(['time', 'staff', 'cast']);

/** Typed text → lines: spaces tidied, empty lines dropped (times and header names also put in their style). */
export function tidy(col: EditCol, text: string): string[] {
  return text
    .normalize('NFC')
    .split(/\r?\n/)
    .map((l) => l.replace(/[\t\u00a0 ]+/g, ' ').trim())
    .filter(Boolean)
    .map((l, i) => (GENERATED.has(col) ? formatLine(col, l, i) : l));
}

/** The guideline's style for a new line of a column ("-" in 세부사항, "- " under a 내용 title, Mic, 65%). */
export const autoformat = (col: EditCol, line: string, i: number) => formatLine(col, line, i);

// ---------------- alignment ----------------

interface Pair { i?: number; j?: number; same?: boolean }

const bigrams = (s: string) => {
  const t = lineKey(s);
  const out = new Map<string, number>();
  for (let k = 0; k < t.length - 1; k++) out.set(t.slice(k, k + 2), (out.get(t.slice(k, k + 2)) ?? 0) + 1);
  return out;
};
/** 0..1: how alike two lines are (shared letter pairs) */
export function similarity(a: string, b: string): number {
  const x = bigrams(a), y = bigrams(b);
  let both = 0, n = 0;
  for (const [g, c] of x) { both += Math.min(c, y.get(g) ?? 0); n += c; }
  for (const c of y.values()) n += c;
  return n ? (2 * both) / n : lineKey(a) === lineKey(b) ? 1 : 0;
}

/**
 * Lines of `a` matched to lines of `b`: equal lines by longest common subsequence; in between, lines are paired as
 * changed lines (one for one when the counts agree, otherwise the most alike in order), the rest removed or added.
 */
export function align(
  a: string[], b: string[],
  score: (i: number, j: number) => number = (i, j) => similarity(a[i], b[j]),
  eq: (i: number, j: number) => boolean = (i, j) => lineKey(a[i]) === lineKey(b[j]),
): Pair[] {
  const n = a.length, m = b.length;
  const E = Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => eq(i, j)));
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = E[i][j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Pair[] = [];
  let ha: number[] = [], hb: number[] = [];
  const flush = () => {
    out.push(...pairHunk(ha, hb, score));
    ha = [];
    hb = [];
  };
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && E[i][j]) {
      flush();
      out.push({ i: i++, j: j++, same: true });
    } else if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) ha.push(i++);
    else hb.push(j++);
  }
  flush();
  return out;
}

const PAIR_MIN = 0.25;
function pairHunk(ha: number[], hb: number[], score: (i: number, j: number) => number): Pair[] {
  if (!ha.length) return hb.map((j) => ({ j }));
  if (!hb.length) return ha.map((i) => ({ i }));
  if (ha.length === hb.length && ha.every((i, k) => score(i, hb[k]) >= 0)) return ha.map((i, k) => ({ i, j: hb[k] }));
  // most alike pairs, in order (small hunks: plain dynamic programming)
  const n = ha.length, m = hb.length;
  const best = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let x = n - 1; x >= 0; x--)
    for (let y = m - 1; y >= 0; y--) {
      const s = score(ha[x], hb[y]);
      best[x][y] = Math.max(best[x + 1][y], best[x][y + 1], s >= PAIR_MIN ? best[x + 1][y + 1] + s : -1);
    }
  const out: Pair[] = [];
  let x = 0, y = 0;
  while (x < n || y < m) {
    if (x < n && y < m) {
      const s = score(ha[x], hb[y]);
      if (s >= PAIR_MIN && best[x][y] === best[x + 1][y + 1] + s) { out.push({ i: ha[x++], j: hb[y++] }); continue; }
      if (best[x][y] === best[x + 1][y]) { out.push({ i: ha[x++] }); continue; }
      out.push({ j: hb[y++] });
    } else if (x < n) out.push({ i: ha[x++] });
    else out.push({ j: hb[y++] });
  }
  return out;
}

/**
 * Line changes that turn the cell `old` into the typed lines `neu`. Anchors are the lines' text, so they survive changes
 * elsewhere; lines that say the same as the cell (same data, other spacing) are left alone, new lines get `mark`.
 */
export function diffOps(old: OutLine[], neu: string[], mark: (l: string, j: number) => string = (l) => l): LineOp[] {
  const texts = old.map((l) => l.text);
  const marked = neu.map(mark);
  if (!old.length) return neu.length ? [{ op: 'set', lines: marked }] : [];
  const pairs = align(texts, neu, undefined, (i, j) => equivalent(old[i], neu[j], marked[j]));
  if (neu.length && !pairs.some((p) => p.same)) return [{ op: 'set', lines: marked }];
  const ops: LineOp[] = [];
  let prev: string | null = null;
  for (const p of pairs) {
    if (p.same) prev = texts[p.i!];
    else if (p.i != null && p.j != null) {
      ops.push({ op: 'replace', line: texts[p.i], with: marked[p.j] });
      prev = marked[p.j];
    } else if (p.i != null) ops.push({ op: 'remove', line: texts[p.i] });
    else {
      ops.push({ op: 'insert', after: prev, line: marked[p.j!] });
      prev = marked[p.j!];
    }
  }
  return ops;
}

/** A typed line says the same as a cell line: same text, or the same list item / fill-in values in other spacing. */
function equivalent(o: OutLine, typed: string, marked = typed): boolean {
  const k = lineKey(o.text);
  if (k === lineKey(typed) || k === lineKey(marked)) return true;
  const src = o.src;
  if (src && 'list' in src) {
    const item = unformat(typed, src.fmt);
    return item != null && lineKey(src.fmt.replace('{n}', String(src.i + 1)).replace('{item}', item.replace(/\s*->\s*/g, ' → '))) === k;
  }
  if (src && 'tpl' in src) {
    const { re } = tplPattern(src.tpl);
    const a = re.exec(o.text), b = re.exec(typed) ?? re.exec(marked);
    return !!a && !!b && a.slice(1).every((v, g) => lineKey(v ?? '') === lineKey(b[g + 1] ?? ''));
  }
  return false;
}

// ---------------- writing to the data ----------------

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** literal text; typed lines may space it any way ("봉헌위원 :", "- 본문") */
const lit = (s: string) => ['', ...[...s.replace(/\s+/g, '')].map(esc), ''].join('\\s*');

/** Item text from a formatted list line ("2. 곡명", "- 본문"); null when the line is empty. */
export function unformat(text: string, fmt: string): string | null {
  const re = new RegExp('^' + fmt.split(/(\{n\}|\{item\})/).map((p) => (p === '{n}' ? '\\d+' : p === '{item}' ? '(.*)' : lit(p))).join('') + '$');
  const m = re.exec(text);
  const bare = !/\S/.test(fmt.split('{item}')[0].replace('{n}', '0'));
  const item = (m && !bare ? m[1] ?? '' : text.replace(/^(\d+\s*[.)]|[-–•·])\s*/, '')).trim();
  return item || null;
}

interface TplToken { name: string; def?: string }
/** A pattern for the lines a template can produce: one group per token. */
function tplPattern(tpl: string): { re: RegExp; tokens: TplToken[] } {
  const t = tpl.startsWith('**') ? tpl.slice(2) : tpl;
  const tokens: TplToken[] = [];
  let src = '', last = 0;
  for (const m of t.matchAll(TOKEN)) {
    let before = t.slice(last, m.index);
    // "#1-{vocals}" reads "#1" for one singer
    const one = (m[1] === 'vocals' || m[1] === 'leaders') && before.endsWith('#1-');
    if (one) before = before.slice(0, -1);
    src += lit(before);
    tokens.push({ name: m[1], ...(m[2] != null ? { def: m[2] } : {}) });
    src += one ? '(?:-\\s*(\\d+))?' : /^t[+-]\d+$/.test(m[1]) ? '(\\d{1,2}:\\d{2})' : COMPUTED.has(m[1]) ? '(\\d+)' : '(.*?)';
    last = (m.index ?? 0) + m[0].length;
  }
  src += lit(t.slice(last));
  return { re: new RegExp(`^${src}$`), tokens };
}

interface Ctx {
  rules: RulesFile;
  doc: CueDoc;
  sid: string;
  row: string;
  col: EditCol;
  scope: string[];
  /** every service, built before this change */
  sheets: Sheet[];
  changes: string[];
}

const svcLabel = (c: Ctx, s: string) => c.rules.services[s]?.label ?? s;
const norm = (kind: FieldKind, v: unknown) =>
  kind === 'lists' ? ((v as string[] | undefined) ?? []).map((x) => x.trim()).filter(Boolean) : ((v as string | undefined) ?? '').trim();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Services that show a field: its tokens appear in their rows, or the header lists the person. */
function users(c: Ctx, kind: FieldKind, key: string): Set<string> {
  const out = new Set<string>();
  for (const sh of c.sheets) {
    const sid = sh.serviceId;
    if (kind === 'people') {
      if (c.rules.staffOrder.includes(key) || c.rules.services[sid].cast.some(([k]) => k === key)) out.add(sid);
    } else if (sh.rows.some((r) => r.fields[kind].includes(key))) out.add(sid);
  }
  out.add(c.sid);
  return out;
}

/**
 * Writes a field the cell shows. A header name is typed like in the service's form (the shared value where it was
 * typed or where there is none yet, otherwise this service's own); any other field changes for the services picked
 * for the change, and the others keep what they show. Notes the services that now show something else.
 */
function writeField(c: Ctx, kind: FieldKind, key: string, value: string | string[]) {
  const { rules, doc } = c;
  const use = users(c, kind, key);
  const sids = docServices(rules, doc);
  const shown = (s: string) => {
    const v = fieldValue(rules, doc, s, kind, key);
    return Array.isArray(v) ? v.join(' / ') : v ?? '';
  };
  const before = new Map(sids.map((s) => [s, JSON.stringify(fieldValue(rules, doc, s, kind, key) ?? null)]));
  if (c.row === 'header') typeField(rules, doc, c.sid, kind, key, value);
  else writeFieldFor(rules, doc, kind, key, value, c.scope.filter((s) => s === c.sid || use.has(s)), use);
  const changed = sids.filter((s) => (use.has(s) || c.scope.includes(s)) && before.get(s) !== JSON.stringify(fieldValue(rules, doc, s, kind, key) ?? null));
  const groups = new Map<string, string[]>();
  for (const s of changed) groups.set(shown(s), [...(groups.get(shown(s)) ?? []), svcLabel(c, s)]);
  for (const [v, labels] of groups) c.changes.push(`${key}: ${v || '(빈 값)'} — ${labels.join(', ')}`);
}

function writeCount(c: Ctx, key: 'vocals' | 'leaders', n: number) {
  for (const s of c.scope) {
    if (n === c.rules.services[s].defaults[key]) delete c.doc.services[s][key];
    else c.doc.services[s][key] = n;
  }
  c.changes.push(`${key === 'vocals' ? '보컬' : '인도자'} ${n}명 — ${c.scope.map((s) => svcLabel(c, s)).join(', ')}`);
}

function writeDur(c: Ctx, row: string, n: number, scope = c.scope) {
  const rowOf = (s: string) => c.sheets.find((sh) => sh.serviceId === s)?.rows.find((r) => r.key === row);
  const to = scope.filter((s) => rowOf(s));
  for (const s of to) {
    if (rowOf(s)!.ruleDur === n) delete c.doc.services[s].durs[row];
    else c.doc.services[s].durs[row] = n;
  }
  c.changes.push(`'${rowOf(c.sid)?.name ?? row}' ${n}분 — ${to.map((s) => svcLabel(c, s)).join(', ')}`);
}

/** List items and fill-in values the typed lines change. */
function routeLines(c: Ctx, old: OutLine[], neu: string[]) {
  const score = (i: number, j: number) => {
    const src = old[i].src;
    if (src && 'tpl' in src && tplPattern(src.tpl).re.test(neu[j])) return 1;
    // a ▶ title, (note), ※ … line is never a list item
    if (src && 'list' in src) return MARKED.test(neu[j].replace(/^-\s*/, '')) ? -1 : Math.max(0.5, similarity(old[i].text, neu[j]));
    return similarity(old[i].text, neu[j]);
  };
  const mk = neu.map((l, j) => autoformat(c.col, l, j));
  const pairs = align(old.map((l) => l.text), neu, score, (i, j) => equivalent(old[i], neu[j], mk[j]));
  const listOf = (p: Pair | undefined) => {
    const src = p?.i != null ? old[p.i].src : undefined;
    return src && 'list' in src ? src : null;
  };

  // lists: the items as now typed, in order; a line added next to a list's lines is a new item of it
  const lists = new Map<string, { fmt: string; items: string[]; changed: boolean }>();
  const listFor = (name: string, fmt: string) => {
    if (!lists.has(name)) lists.set(name, { fmt, items: [], changed: false });
    return lists.get(name)!;
  };
  const owner: (string | null)[] = pairs.map(() => null);
  pairs.forEach((p, k) => {
    const ls = listOf(p);
    if (ls) {
      const L = listFor(ls.list, ls.fmt);
      owner[k] = ls.list;
      if (p.j == null) { L.changed = true; return; }
      const item = unformat(neu[p.j], ls.fmt);
      if (item) L.items.push(item);
      if (!p.same) L.changed = true;
      return;
    }
    if (p.i != null || p.j == null || /^[(*※■▶[]/.test(neu[p.j].replace(/^-\s*/, ''))) return;
    const next = listOf(pairs[k + 1]);
    const name = (k > 0 ? owner[k - 1] : null) ?? next?.list ?? null;
    if (!name) return;
    const L = lists.get(name) ?? listFor(name, next!.fmt);
    const item = unformat(neu[p.j], L.fmt);
    if (!item) return;
    L.items.push(item);
    L.changed = true;
    owner[k] = name;
  });
  for (const [name, L] of lists) {
    // an emptied list would bring back the guideline's example lines: leave it, the lines are taken out as edits
    if (L.changed && L.items.length && !same(L.items, norm('lists', fieldValue(c.rules, c.doc, c.sid, 'lists', name)))) writeField(c, 'lists', name, L.items);
  }

  // fill-in values of changed template lines
  const values = new Map<string, string>();
  const counts = new Set<string>();
  for (const p of pairs) {
    if (p.same || p.i == null || p.j == null) continue;
    const src = old[p.i].src;
    if (!src || !('tpl' in src)) continue;
    const { re, tokens } = tplPattern(src.tpl);
    const m = re.exec(neu[p.j]);
    if (!m) continue;
    tokens.forEach((t, g) => {
      const v = (m[g + 1] ?? '').trim();
      if (t.name === 'vocals' || t.name === 'leaders') {
        const svc = c.rules.services[c.sid];
        const cur = c.doc.services[c.sid][t.name] ?? svc.defaults[t.name];
        const n = v === '' ? 1 : Number(v);
        if (n !== cur && n > 0 && !counts.has(t.name)) { counts.add(t.name); writeCount(c, t.name, n); }
      } else if (t.name === 'dur') {
        const r = c.sheets.find((sh) => sh.serviceId === c.sid)?.rows.find((x) => x.key === c.row);
        if (r && Number(v) !== r.dur) writeDur(c, c.row, Number(v));
      } else if (!COMPUTED.has(t.name) && !/^t[+-]\d+$/.test(t.name)) {
        const cur = norm('values', fieldValue(c.rules, c.doc, c.sid, 'values', t.name)) as string;
        if (v !== cur && !(cur === '' && v === (t.def ?? '').trim())) values.set(t.name, v);
      }
    });
  }
  for (const [k, v] of values) writeField(c, 'values', k, v);
}

/** People in the header: "-PD: 이름", "■사회: 이름". */
function routePeople(c: Ctx, old: OutLine[], neu: string[]) {
  const svc = c.rules.services[c.sid];
  const keyOf = (label: string) =>
    c.col === 'staff' ? (c.rules.staffOrder.includes(label) ? label : null) : svc.cast.find(([, l]) => l === label)?.[0] ?? null;
  const parse = (l: string) => {
    const m = (c.col === 'staff' ? /^-?\s*([^:：]+?)\s*[:：]\s*(.*)$/ : /^■?\s*([^:：]+?)\s*[:：]\s*(.*)$/).exec(l);
    const key = m ? keyOf(m[1]) : null;
    return key ? { key, name: m![2].trim() } : null;
  };
  const typed = new Map<string, string>();
  for (const l of neu) {
    const p = parse(l);
    if (p && !typed.has(p.key)) typed.set(p.key, p.name);
  }
  for (const l of old) {
    const p = parse(l.text);
    if (p && !typed.has(p.key)) typed.set(p.key, '');
  }
  for (const [key, name] of typed) {
    if (name !== norm('people', fieldValue(c.rules, c.doc, c.sid, 'people', key))) writeField(c, 'people', key, name);
  }
}

/** The time cell: start time, minutes, end time. */
function routeTime(c: Ctx, neu: string[]) {
  const sheet = c.sheets.find((sh) => sh.serviceId === c.sid)!;
  const idx = sheet.rows.findIndex((r) => r.key === c.row);
  const r = sheet.rows[idx];
  if (!r) return;
  let start: number | undefined, dur: number | undefined, end: number | undefined;
  for (const l of neu) {
    let m = /^\*(\d{2}):(\d{2})$/.exec(l);
    if (m) { end ??= Number(m[1]) * 60 + Number(m[2]); continue; }
    m = /^(\d{2}):(\d{2})$/.exec(l);
    if (m) { start ??= Number(m[1]) * 60 + Number(m[2]); continue; }
    m = /^\((\d+)’\)$/.exec(l);
    if (m) dur ??= Number(m[1]);
  }
  const sd = c.doc.services[c.sid];
  const svc = c.rules.services[c.sid];
  const was = toMin(r.start);
  if (start != null && start !== was) {
    if (idx === 0) {
      const t = fmtMin(start);
      if (t === svc.start) delete sd.start;
      else sd.start = t;
      c.changes.push(`시작 시간 ${t} — ${svcLabel(c, c.sid)}`);
    } else {
      const p = sheet.rows[idx - 1];
      const d = p.dur + (start - was);
      if (d >= 0) writeDur(c, p.key, d, [c.sid]);
      else c.changes.push(`${fmtMin(start)}: '${p.name}' 시작(${p.start})보다 빨라 바꿀 수 없습니다`);
    }
  }
  let d = dur ?? r.dur;
  // a changed end time (last row) sets the row's minutes
  if (end != null && idx === sheet.rows.length - 1 && end !== toMin(sheet.end)) d = (end - (start ?? was) + 1440) % 1440;
  if (d !== r.dur) writeDur(c, c.row, d, [c.sid]);
}

/** A changed title of a row the user added renames it everywhere it was added. */
function routeTitle(c: Ctx, old: OutLine[], neu: string[]) {
  if (!c.row.startsWith('custom:') || !old[0] || !neu[0]?.startsWith('▶') || lineKey(old[0].text) === lineKey(neu[0])) return;
  const title = neu[0].slice(1).trim();
  if (!title) return;
  for (const s of c.scope) for (const m of c.doc.services[s]?.moves ?? []) if (m.key === c.row && m.title != null) m.title = title;
  c.changes.push(`순서 이름: ${title}`);
}

// ---------------- save ----------------

/** `scope`: other services the change also goes to (this service always does). */
export interface SaveCell { sid: string; row: string; col: EditCol; text: string; scope?: string[] }
export interface SaveResult {
  doc: CueDoc;
  /** what changed in the data (for a short message) */
  changes: string[];
  /** the line changes kept for the cell (none when the data explains everything) */
  edits: CellEdit[];
}

/** The cell the user typed, saved into a copy of the document. */
export function saveCell(rules: RulesFile, doc0: CueDoc, input: SaveCell, at = new Date().toISOString()): SaveResult {
  const { sid, row, col } = input;
  const doc = clone(doc0);
  const sheets = buildDoc(rules, doc);
  const all = docServices(rules, doc);
  const others = ownOnly(row, col) ? [] : (input.scope ?? []).filter((s) => s !== sid && all.includes(s));
  const scope = [sid, ...others.filter((s) => cellLines(sheets.find((sh) => sh.serviceId === s)!, row, col) != null)];
  const neu = tidy(col, input.text);
  const mine = cellEdits(doc, sid, row, col).map((e) => e.id);
  const base = cellLines(buildSheet(rules, doc, sid, { exclude: mine }), row, col);
  if (!base) throw new Error('이 예배에는 그 칸이 없습니다');
  const c: Ctx = { rules, doc, sid, row, col, scope, sheets, changes: [] };

  if (row === 'header' && (col === 'staff' || col === 'cast')) routePeople(c, base, neu);
  else if (col === 'time' && row !== 'rehearsal' && row !== 'header') routeTime(c, neu);
  else if (row !== 'header') {
    routeTitle(c, base, neu);
    routeLines(c, base, neu);
  }

  // what the data does not explain stays as line changes on the cell (an order row's times are always worked out)
  const now = cellLines(buildSheet(rules, doc, sid, { exclude: mine }), row, col) ?? [];
  const timed = col === 'time' && row !== 'rehearsal';
  const ops = timed ? [] : diffOps(now, neu, (l, j) => autoformat(col, l, j));

  // the new edit takes the place of the old one wherever the old one applied in the scope
  for (const e of doc.edits) if (mine.includes(e.id)) e.services = e.services.filter((s) => !scope.includes(s));
  doc.edits = doc.edits.filter((e) => e.services.length);

  const edits: CellEdit[] = [];
  if (ops.length) {
    // 담당 변경 (사회자 → 설교자) also changes the row's Mic and the names in 세부사항, with each service's own Mic
    const groups = new Map<string, { services: string[]; also: CellEdit['also']; note?: string }>();
    for (const s of scope) {
      const rm = rules.services[s].roleMics;
      const swaps = col === 'role'
        ? ops.flatMap((o) => (o.op === 'replace' && rm[lineKey(o.line)] && rm[lineKey(o.with)] ? [{ from: lineKey(o.line), to: lineKey(o.with) }] : []))
        : [];
      const also = swaps.length ? roleLinks(rules, buildSheet(rules, doc, s), row, swaps) : [];
      const note = swaps.length ? `담당 변경: ${swaps.map((w) => `${w.from} → ${w.to}`).join(', ')}` : undefined;
      const k = JSON.stringify([also, note]);
      if (!groups.has(k)) groups.set(k, { services: [], also, ...(note ? { note } : {}) });
      groups.get(k)!.services.push(s);
    }
    for (const g of groups.values()) {
      const e: CellEdit = { id: newId(), row, col, services: g.services, ops: clone(ops), at, ...(g.also?.length ? { also: g.also } : {}), ...(g.note ? { note: g.note } : {}) };
      doc.edits.push(e);
      edits.push(e);
    }
  }
  doc.updatedAt = at;
  return { doc, changes: c.changes, edits };
}

/**
 * ↺ 원래대로: the cell's line changes are taken out of this service (typed data stays). A 담당 change that also changed
 * this cell keeps its other changes; only this cell goes back.
 */
export function resetCell(doc0: CueDoc, sid: string, row: string, col: EditCol): CueDoc {
  const doc = clone(doc0);
  const out: CellEdit[] = [];
  for (const e of doc.edits) {
    if (e.row === row && e.services.includes(sid)) {
      if (e.col === col) e.services = e.services.filter((s) => s !== sid);
      else if (e.also?.some((a) => a.col === col)) {
        e.services = e.services.filter((s) => s !== sid);
        const { also, ...rest } = clone(e);
        const left = also!.filter((a) => a.col !== col);
        out.push(e, { ...rest, id: newId(), services: [sid], ...(left.length ? { also: left } : {}) });
        continue;
      }
    }
    out.push(e);
  }
  doc.edits = out.filter((e) => e.services.length);
  doc.updatedAt = new Date().toISOString();
  return doc;
}

/** Takes a saved line change out of the document. */
export function removeEdit(doc0: CueDoc, id: string): CueDoc {
  const doc = clone(doc0);
  doc.edits = doc.edits.filter((e) => e.id !== id);
  doc.updatedAt = new Date().toISOString();
  return doc;
}
