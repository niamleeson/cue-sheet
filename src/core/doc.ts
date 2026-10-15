import { COLS } from './types';
import type { CellEdit, CueDoc, EditCol, Fields, Kind, LineOp, Move, RulesFile, ServiceDoc } from './types';

export type FieldKind = keyof Fields;
export const FIELD_KINDS: FieldKind[] = ['people', 'values', 'lists'];
type FieldVal = string | string[];

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
export const emptyFields = (): Fields => ({ people: {}, values: {}, lists: {} });
const emptyOrigin = (): CueDoc['origin'] => ({ people: {}, values: {}, lists: {} });
export const emptyServiceDoc = (): ServiceDoc => ({ ...emptyFields(), specials: {}, moves: [], off: [], durs: {} });
export const docId = (kind: Kind, date: string) => `${kind}-${date}`;

export const occasionOf = (rules: RulesFile, kind: Kind) => rules.occasions.find((o) => o.id === kind) ?? rules.occasions[0];

export function emptyDoc(rules: RulesFile, kind: Kind, date: string): CueDoc {
  return {
    v: 2, id: docId(kind, date), kind, date, updatedAt: new Date().toISOString(), shared: emptyFields(), origin: emptyOrigin(),
    services: Object.fromEntries(occasionOf(rules, kind).services.map((s) => [s, emptyServiceDoc()])), edits: [],
  };
}

/** The document's services in the occasion's order. */
export const docServices = (rules: RulesFile, doc: CueDoc) => occasionOf(rules, doc.kind).services.filter((s) => doc.services[s]);

/** Nothing typed: an empty or blank text, a list without a line. */
export const isBlank = (v: unknown) => (Array.isArray(v) ? !v.some((x) => String(x).trim()) : v == null || !String(v).trim());

/** 출연 the guideline leaves empty when there is none (2부 사회): it never takes another service's value. */
export function ownOnly(rules: RulesFile, sid: string, kind: FieldKind, key: string): boolean {
  return kind === 'people' && !!rules.services[sid]?.cast.some(([k, , optional]) => k === key && optional);
}

const ownOf = (doc: CueDoc, sid: string, kind: FieldKind) => doc.services[sid]?.[kind] as Record<string, FieldVal> | undefined;
export const hasOwn = (doc: CueDoc, sid: string, kind: FieldKind, key: string) => key in (ownOf(doc, sid, kind) ?? {});

/** Services that take the shared value of a field: they have no value of their own. */
export const followers = (rules: RulesFile, doc: CueDoc, kind: FieldKind, key: string) =>
  docServices(rules, doc).filter((s) => !ownOnly(rules, s, kind, key) && !hasOwn(doc, s, kind, key));

/**
 * The service whose form shows the shared value as typed text (where it was typed; the first service that takes it when
 * that one has its own value now). null when there is no shared value or no service takes it.
 */
export function originOf(rules: RulesFile, doc: CueDoc, kind: FieldKind, key: string): string | null {
  if (isBlank(doc.shared[kind][key])) return null;
  const f = followers(rules, doc, kind, key);
  const o = doc.origin[kind][key];
  return o && f.includes(o) ? o : f[0] ?? null;
}

export function resolveFields(rules: RulesFile, doc: CueDoc, sid: string): Fields {
  const sd = doc.services[sid] ?? emptyServiceDoc();
  const people = { ...doc.shared.people };
  for (const k of Object.keys(people)) if (ownOnly(rules, sid, 'people', k)) delete people[k];
  return {
    people: { ...people, ...sd.people },
    values: { ...doc.shared.values, ...sd.values },
    lists: { ...doc.shared.lists, ...sd.lists },
  };
}

/** What a service prints for a field: its own value, otherwise the shared one. */
export function fieldValue<K extends FieldKind>(rules: RulesFile, doc: CueDoc, sid: string, kind: K, key: string): Fields[K][string] | undefined {
  type V = Record<string, Fields[K][string]>;
  const own = doc.services[sid]?.[kind] as V | undefined;
  if (own && key in own) return own[key];
  if (ownOnly(rules, sid, kind, key)) return undefined;
  return (doc.shared[kind] as V)[key];
}

/**
 * A field as a service's form shows it: `text` typed in this form (its own value, or the shared value when it was typed
 * here), or `from`: the shared value typed in another service's form, shown as the placeholder.
 */
export function fieldShow<K extends FieldKind>(rules: RulesFile, doc: CueDoc, sid: string, kind: K, key: string): { text?: Fields[K][string]; from?: { sid: string; value: Fields[K][string] } } {
  type V = Record<string, Fields[K][string]>;
  const own = doc.services[sid]?.[kind] as V | undefined;
  if (own && key in own) return { text: own[key] };
  if (ownOnly(rules, sid, kind, key)) return {};
  const o = originOf(rules, doc, kind, key);
  if (o == null) return {};
  const value = (doc.shared[kind] as V)[key];
  return o === sid ? { text: value } : { from: { sid: o, value } };
}

/** The shared value of a field and the form it was typed in; a blank value removes it (mutates `doc`). */
export function setShared(doc: CueDoc, kind: FieldKind, key: string, value: FieldVal, origin: string) {
  const shared = doc.shared[kind] as Record<string, FieldVal>;
  if (isBlank(value)) {
    delete shared[key];
    delete doc.origin[kind][key];
  } else {
    shared[key] = clone(value);
    doc.origin[kind][key] = origin;
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

/**
 * A field every service has the same value of (text import, older saved weeks) becomes the shared value, as if typed
 * in the first service's form (mutates `doc`).
 */
export function hoistShared(rules: RulesFile, doc: CueDoc) {
  const sids = docServices(rules, doc);
  for (const kind of FIELD_KINDS) {
    for (const key of new Set(sids.flatMap((s) => Object.keys(doc.services[s][kind])))) {
      const take = sids.filter((s) => !ownOnly(rules, s, kind, key));
      if (take.length < 2) continue;
      const vals = take.map((s) => ownOf(doc, s, kind)![key]);
      if (vals.some((v) => v === undefined || isBlank(v)) || !vals.every((v) => JSON.stringify(v) === JSON.stringify(vals[0]))) continue;
      setShared(doc, kind, key, vals[0], take[0]);
      for (const s of take) delete ownOf(doc, s, kind)![key];
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
 * Where shared values were typed, and empty values that mean nothing typed dropped. Documents of 0.2.0 have no
 * `origin` and print the same as before: a shared 출연 the guideline leaves empty (2부 사회) becomes that service's own,
 * and an empty value of a service that hid the shared one ('이 예배만') stays until something is typed there.
 */
function readOrigin(rules: RulesFile, doc: CueDoc, x: unknown) {
  const legacy = !isObj(x);
  for (const kind of FIELD_KINDS) {
    const shared = doc.shared[kind] as Record<string, FieldVal>;
    for (const [k, v] of Object.entries(shared)) if (isBlank(v)) delete shared[k];
    const o = !legacy && isObj(x[kind]) ? x[kind] : {};
    for (const [k, s] of Object.entries(o)) if (isStr(s) && doc.services[s] && k in shared) doc.origin[kind][k] = s;
    for (const sid of Object.keys(doc.services)) {
      const own = ownOf(doc, sid, kind)!;
      if (legacy) for (const [k, v] of Object.entries(shared)) if (ownOnly(rules, sid, kind, k) && !(k in own)) own[k] = clone(v);
      for (const [k, v] of Object.entries(own)) if (isBlank(v) && (ownOnly(rules, sid, kind, k) || !(k in shared))) delete own[k];
    }
  }
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
  readOrigin(rules, doc, x.origin);
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
