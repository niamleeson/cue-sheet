import { COLS } from './types';
import type { CellEdit, CueDoc, EditCol, Fields, Kind, LineOp, Move, RulesFile, ServiceDoc } from './types';

/** Fields that are usually the same for every service of the day; they start out shared (공통). */
export const SHARED_DEFAULT = new Set([
  '설교', '본문', '설교제목', '영상이름', '선교지', '파송팀', '파송인원', '과정', '수료자', '수료인원', '간증자',
]);
export type FieldKind = keyof Fields;
export type FieldMode = 'shared' | 'own';

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
export const emptyFields = (): Fields => ({ people: {}, values: {}, lists: {} });
export const emptyServiceDoc = (): ServiceDoc => ({ ...emptyFields(), specials: {}, moves: [], off: [], durs: {} });
export const docId = (kind: Kind, date: string) => `${kind}-${date}`;

export const occasionOf = (rules: RulesFile, kind: Kind) => rules.occasions.find((o) => o.id === kind) ?? rules.occasions[0];

export function emptyDoc(rules: RulesFile, kind: Kind, date: string): CueDoc {
  return {
    v: 2, id: docId(kind, date), kind, date, updatedAt: new Date().toISOString(), shared: emptyFields(),
    services: Object.fromEntries(occasionOf(rules, kind).services.map((s) => [s, emptyServiceDoc()])), edits: [],
  };
}

/** The document's services in the occasion's order. */
export const docServices = (rules: RulesFile, doc: CueDoc) => occasionOf(rules, doc.kind).services.filter((s) => doc.services[s]);

/** 'own' when the service has its own value (even empty); otherwise shared when the document has one or the key is shared by default. */
export function fieldMode(doc: CueDoc, sid: string, kind: FieldKind, key: string): FieldMode {
  const own = doc.services[sid]?.[kind];
  if (own && key in own) return 'own';
  if (key in doc.shared[kind]) return 'shared';
  return SHARED_DEFAULT.has(key) ? 'shared' : 'own';
}

export function resolveFields(doc: CueDoc, sid: string): Fields {
  const sd = doc.services[sid] ?? emptyServiceDoc();
  return {
    people: { ...doc.shared.people, ...sd.people },
    values: { ...doc.shared.values, ...sd.values },
    lists: { ...doc.shared.lists, ...sd.lists },
  };
}

export function fieldValue<K extends FieldKind>(doc: CueDoc, sid: string, kind: K, key: string): Fields[K][string] | undefined {
  type V = Record<string, Fields[K][string]>;
  const own = doc.services[sid]?.[kind] as V | undefined;
  if (own && key in own) return own[key];
  return (doc.shared[kind] as V)[key];
}

/** Writes a field where it currently lives (mutates `doc`). */
export function setField<K extends FieldKind>(doc: CueDoc, sid: string, kind: K, key: string, value: Fields[K][string], mode = fieldMode(doc, sid, kind, key)) {
  const target = (mode === 'own' ? doc.services[sid][kind] : doc.shared[kind]) as Record<string, Fields[K][string]>;
  target[key] = value;
}

/** Switches a field between 공통 and 이 예배만 without losing what the service shows (mutates `doc`). */
export function setFieldMode(doc: CueDoc, sid: string, kind: FieldKind, key: string, mode: FieldMode) {
  const sd = doc.services[sid];
  const cur = fieldValue(doc, sid, kind, key);
  if (mode === 'own') {
    (sd[kind] as Record<string, unknown>)[key] = clone(cur ?? (kind === 'lists' ? [] : ''));
  } else {
    if (!(key in doc.shared[kind]) && cur !== undefined) (doc.shared[kind] as Record<string, unknown>)[key] = clone(cur);
    delete (sd[kind] as Record<string, unknown>)[key];
  }
}

/** Places rows according to `moves`; `make` builds rows the user added (moves with a title). */
export function applyMoves<T extends { key: string }>(rows: T[], moves: Move[], make: (m: Move) => T): { rows: T[]; moved: Set<string> } {
  const out = rows.slice();
  const moved = new Set<string>();
  for (const m of moves) {
    const i = out.findIndex((r) => r.key === m.key);
    let r: T;
    if (i >= 0) [r] = out.splice(i, 1);
    else if (m.title != null) r = make(m);
    else continue; // the row is not in this service right now (special off)
    let pos: number;
    const a = m.after == null ? -1 : out.findIndex((x) => x.key === m.after);
    const b = m.before == null ? -1 : out.findIndex((x) => x.key === m.before);
    if (m.after === null) pos = 0;
    else if (a >= 0) pos = a + 1;
    else if (b >= 0) pos = b;
    else if (m.before === null) pos = out.length;
    else pos = i >= 0 ? Math.min(i, out.length) : out.length;
    out.splice(pos, 0, r);
    moved.add(m.key);
  }
  return { rows: out, moved };
}

/** Indices (into `seq`) of a longest strictly increasing subsequence, ignoring negative entries. */
function lis(seq: number[]): Set<number> {
  const tails: number[] = [], prev: number[] = new Array(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] < 0) continue;
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[i]) lo = mid + 1; else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) keep.add(i);
  return keep;
}

/**
 * The fewest moves that turn `base` (guideline order) into `final`. Rows the user added always get a move (it carries
 * their title). Moves of rows that are not present now (a special that is off) are kept so the row returns to its place.
 */
export function computeMoves(base: string[], final: string[], titles: Record<string, string>, old: Move[]): Move[] {
  const keep = lis(final.map((k) => (titles[k] != null ? -1 : base.indexOf(k))));
  const moves: Move[] = [];
  final.forEach((key, n) => {
    if (keep.has(n)) return;
    moves.push({ key, after: n > 0 ? final[n - 1] : null, before: n < final.length - 1 ? final[n + 1] : null, ...(titles[key] != null ? { title: titles[key] } : {}) });
  });
  for (const m of old) if (!final.includes(m.key) && m.title == null && !moves.some((x) => x.key === m.key)) moves.push(m);
  return moves;
}

/** Moves a field value that every service has identically into the shared fields (for SHARED_DEFAULT keys). */
export function hoistShared(doc: CueDoc, sids = Object.keys(doc.services)) {
  if (sids.length < 2) return;
  for (const kind of ['people', 'values', 'lists'] as FieldKind[]) {
    for (const key of SHARED_DEFAULT) {
      const vals = sids.map((s) => (doc.services[s][kind] as Record<string, unknown>)[key]);
      if (vals.some((v) => v === undefined)) continue;
      const j = JSON.stringify(vals[0]);
      if (!vals.every((v) => JSON.stringify(v) === j)) continue;
      (doc.shared[kind] as Record<string, unknown>)[key] = vals[0];
      for (const s of sids) delete (doc.services[s][kind] as Record<string, unknown>)[key];
    }
  }
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------------- loading saved documents ----------------

const EDIT_COLS = new Set<string>([...COLS, 'time', 'lightA', 'lightB', 'staff', 'cast', 'mics', 'videos']);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';

/** YYYY-MM-DD that is a real calendar day. */
export function isDate(s: unknown): s is string {
  if (!isStr(s) || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function readFields(x: unknown): Fields {
  const f = emptyFields();
  if (!isObj(x)) return f;
  for (const kind of ['people', 'values'] as const) {
    const src = x[kind];
    if (isObj(src)) for (const [k, v] of Object.entries(src)) if (isStr(v)) f[kind][k] = v;
  }
  if (isObj(x.lists)) for (const [k, v] of Object.entries(x.lists)) if (Array.isArray(v)) f.lists[k] = v.filter(isStr);
  return f;
}

function readOp(x: unknown): LineOp | null {
  if (!isObj(x)) return null;
  switch (x.op) {
    case 'remove':
    case 'append':
      return isStr(x.line) ? { op: x.op, line: x.line } : null;
    case 'replace':
      return isStr(x.line) && isStr(x.with) ? { op: 'replace', line: x.line, with: x.with } : null;
    case 'insert':
      return (x.after === null || isStr(x.after)) && isStr(x.line) ? { op: 'insert', after: x.after, line: x.line } : null;
    case 'set':
      return Array.isArray(x.lines) ? { op: 'set', lines: x.lines.filter(isStr) } : null;
    case 'sub':
      return isStr(x.from) && x.from !== '' && isStr(x.to) ? { op: 'sub', from: x.from, to: x.to } : null;
  }
  return null;
}
const readOps = (x: unknown): LineOp[] => (Array.isArray(x) ? x.map(readOp).filter((o): o is LineOp => !!o) : []);

function readService(s: Record<string, unknown>): ServiceDoc {
  const sd: ServiceDoc = { ...readFields(s), specials: {}, moves: [], off: [], durs: {} };
  if (isStr(s.start) && /^\d{1,2}:\d{2}$/.test(s.start)) sd.start = s.start;
  for (const k of ['vocals', 'leaders'] as const) {
    const n = s[k];
    if (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 99) sd[k] = n;
  }
  if (isObj(s.specials)) for (const [k, v] of Object.entries(s.specials)) if (typeof v === 'boolean') sd.specials[k] = v;
  if (Array.isArray(s.moves))
    for (const m of s.moves) {
      if (!isObj(m) || !isStr(m.key) || !m.key || !(m.after === null || isStr(m.after)) || sd.moves.some((y) => y.key === m.key)) continue;
      const mv: Move = { key: m.key, after: m.after };
      if (m.before === null || isStr(m.before)) mv.before = m.before;
      if (isStr(m.title)) mv.title = m.title;
      sd.moves.push(mv);
    }
  if (Array.isArray(s.off)) sd.off = [...new Set(s.off.filter(isStr))];
  if (isObj(s.durs)) for (const [k, v] of Object.entries(s.durs)) if (typeof v === 'number' && Number.isFinite(v) && v >= 0) sd.durs[k] = v;
  return sd;
}

/**
 * A saved or opened document checked field by field; null when it is not a cue sheet document of a known occasion.
 * Anything malformed inside is dropped rather than failing the whole document.
 */
export function normalizeDoc(rules: RulesFile, x: unknown): CueDoc | null {
  if (!isObj(x) || x.v !== 2 || !rules.occasions.some((o) => o.id === x.kind) || !isDate(x.date)) return null;
  const doc = emptyDoc(rules, x.kind as Kind, x.date);
  if (isStr(x.updatedAt) && !Number.isNaN(Date.parse(x.updatedAt))) doc.updatedAt = x.updatedAt;
  if (isStr(x.name) && x.name.trim()) doc.name = x.name;
  doc.shared = readFields(x.shared);
  const svcs = isObj(x.services) ? x.services : {};
  for (const sid of Object.keys(doc.services)) {
    const s = svcs[sid];
    if (isObj(s)) doc.services[sid] = readService(s);
  }
  const sids = Object.keys(doc.services);
  if (Array.isArray(x.edits))
    for (const e of x.edits) {
      if (!isObj(e) || !isStr(e.row) || !e.row || !isStr(e.col) || !EDIT_COLS.has(e.col)) continue;
      const services = Array.isArray(e.services) ? [...new Set(e.services.filter((s): s is string => isStr(s) && sids.includes(s)))] : [];
      const ops = readOps(e.ops);
      if (!services.length || !ops.length) continue;
      const id = isStr(e.id) && e.id && !doc.edits.some((y) => y.id === e.id) ? e.id : newId();
      const ed: CellEdit = { id, row: e.row, col: e.col as EditCol, services, ops, at: isStr(e.at) ? e.at : doc.updatedAt };
      if (Array.isArray(e.also)) {
        const also = e.also.flatMap((a) => (isObj(a) && isStr(a.col) && EDIT_COLS.has(a.col) ? [{ col: a.col as EditCol, ops: readOps(a.ops) }] : [])).filter((a) => a.ops.length);
        if (also.length) ed.also = also;
      }
      if (isStr(e.note) && e.note) ed.note = e.note;
      doc.edits.push(ed);
    }
  return doc;
}
