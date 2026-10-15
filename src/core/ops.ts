/**
 * Changes the form makes to a document: the order list (drag, add, take out, put back), durations, 공통 / 이 예배만
 * fields, and starting a new document from an earlier one. All of them mutate `doc`; the UI works on a copy.
 */
import { buildSheet, guidelineRows, sundayIndex } from './engine';
import { clone, computeMoves, emptyDoc, fieldMode, fieldValue, newId, SHARED_DEFAULT } from './doc';
import type { FieldKind } from './doc';
import type { CueDoc, Fields, RulesFile, ServiceDoc } from './types';

// ---------------- order ----------------

const titlesOf = (sd: ServiceDoc) => Object.fromEntries(sd.moves.filter((m) => m.title != null).map((m) => [m.key, m.title!]));
export const isCustomKey = (sd: ServiceDoc, key: string) => sd.moves.some((m) => m.key === key && m.title != null);

/** Puts the service's rows in the order `keys` (every row the service shows now). */
export function reorder(rules: RulesFile, doc: CueDoc, sid: string, keys: string[]) {
  const sd = doc.services[sid];
  const off = new Set(sd.off);
  const base = guidelineRows(rules, doc, sid).map((r) => r.key).filter((k) => !off.has(k));
  sd.moves = computeMoves(base, keys, titlesOf(sd), sd.moves);
}

/** Minutes of a row; empty or the guideline's own minutes clears the change. */
export function setDur(doc: CueDoc, sid: string, key: string, dur: number | undefined, ruleDur: number | null) {
  const sd = doc.services[sid];
  if (dur == null || (ruleDur != null && dur === ruleDur)) delete sd.durs[key];
  else sd.durs[key] = dur;
}

export function setStart(rules: RulesFile, doc: CueDoc, sid: string, hhmm: string) {
  const sd = doc.services[sid];
  if (!/^\d{2}:\d{2}$/.test(hhmm) || hhmm === rules.services[sid].start) delete sd.start;
  else sd.start = hhmm;
}

export function setCount(rules: RulesFile, doc: CueDoc, sid: string, which: 'vocals' | 'leaders', n: number | undefined) {
  const sd = doc.services[sid];
  if (n == null || n === rules.services[sid].defaults[which]) delete sd[which];
  else sd[which] = n;
}

/** Edits that only this service shows of a row go away; shared ones keep the other services. */
function dropRowEdits(doc: CueDoc, sid: string, row: string) {
  for (const e of doc.edits) if (e.row === row) e.services = e.services.filter((s) => s !== sid);
  doc.edits = doc.edits.filter((e) => e.services.length);
}

/**
 * ✕ on a row: a row the user added is deleted (with its cell changes), a special's row switches the special off, a
 * guideline row is taken out (it can be put back).
 */
export function removeRow(rules: RulesFile, doc: CueDoc, sid: string, key: string) {
  const sd = doc.services[sid];
  if (isCustomKey(sd, key)) {
    sd.moves = sd.moves.filter((m) => m.key !== key);
    delete sd.durs[key];
    dropRowEdits(doc, sid, key);
    return;
  }
  const row = guidelineRows(rules, doc, sid).find((r) => r.key === key);
  if (row?.special) sd.specials[row.special] = false;
  else if (!sd.off.includes(key)) sd.off.push(key);
}

export function restoreRow(doc: CueDoc, sid: string, key: string) {
  const sd = doc.services[sid];
  sd.off = sd.off.filter((k) => k !== key);
}

/** On when the guideline already puts the special on this Sunday (성찬식 첫째 주일, 비전헌금 둘째 주일). */
export function specialAuto(rules: RulesFile, doc: CueDoc, sid: string, id: string) {
  const sp = rules.services[sid].specials.find((x) => x.id === id);
  const wk = sundayIndex(doc.date);
  return !!sp && (sp.auto === 'week1' ? wk === 1 : sp.auto === 'week2' ? wk === 2 : false);
}

/** + 특별순서 from the guideline: on in every picked service that has it (at the guideline's place). */
export function addSpecial(rules: RulesFile, doc: CueDoc, sids: string[], id: string) {
  for (const s of sids) {
    if (!rules.services[s].specials.some((sp) => sp.id === id)) continue;
    const sd = doc.services[s];
    if (specialAuto(rules, doc, s, id)) delete sd.specials[id];
    else sd.specials[id] = true;
    const rows = guidelineRows(rules, doc, s).filter((r) => r.special === id).map((r) => r.key);
    sd.off = sd.off.filter((k) => !rows.includes(k));
  }
}

/**
 * + 특별순서 typed by the user: a row with that title in every picked service, after `after` where the service has that
 * row (null = first), otherwise at the end. The same key in every service, so one cell change can go to all of them.
 */
export function addCustom(rules: RulesFile, doc: CueDoc, sids: string[], title: string, dur: number, after?: string | null): string {
  const key = `custom:${newId()}`;
  for (const s of sids) {
    const sd = doc.services[s];
    if (!sd) continue;
    const keys = buildSheet(rules, doc, s).rows.map((r) => r.key);
    const here = after === null || (after != null && keys.includes(after));
    const a = here ? after! : keys[keys.length - 1] ?? null;
    const i = a == null ? -1 : keys.indexOf(a);
    sd.moves.push({ key, after: a, before: here ? keys[i + 1] ?? null : null, title });
    sd.durs[key] = dur;
  }
  return key;
}

/** A row the user added keeps one name in every service that has it. */
export function renameCustom(doc: CueDoc, key: string, title: string) {
  for (const sd of Object.values(doc.services)) for (const m of sd.moves) if (m.key === key && m.title != null) m.title = title;
}

// ---------------- fields ----------------

const isEmpty = (v: string | string[]) => (Array.isArray(v) ? !v.some((x) => x.trim()) : !v.trim());

/** Types a field where it lives now: 공통 changes every service that uses the shared value, 이 예배만 only this one. */
export function writeField<K extends FieldKind>(doc: CueDoc, sid: string, kind: K, key: string, value: Fields[K][string]) {
  const mode = fieldMode(doc, sid, kind, key);
  const holder = (mode === 'own' ? doc.services[sid][kind] : doc.shared[kind]) as Record<string, unknown>;
  if (!isEmpty(value)) {
    holder[key] = value;
    return;
  }
  // an empty value stays where it is when deleting it would flip 공통 / 이 예배만 (or show the shared value again)
  const keep = mode === 'own' ? key in doc.shared[kind] || SHARED_DEFAULT.has(key) : !SHARED_DEFAULT.has(key);
  if (keep) holder[key] = Array.isArray(value) ? [] : '';
  else delete holder[key];
}

/** Services that show something else than `sid` for a field (공통으로 바꾸면 바뀌는 예배). */
export function differingServices(doc: CueDoc, sid: string, kind: FieldKind, key: string): string[] {
  const j = (v: unknown) => JSON.stringify(Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : typeof v === 'string' ? v.trim() : '');
  const mine = j(fieldValue(doc, sid, kind, key));
  return Object.keys(doc.services).filter((s) => {
    if (s === sid) return false;
    const v = j(fieldValue(doc, s, kind, key));
    return v !== mine && v !== j('') && v !== j([]);
  });
}

/** 공통: this service's value becomes the one value of every service. */
export function makeShared(doc: CueDoc, sid: string, kind: FieldKind, key: string) {
  const v = fieldValue(doc, sid, kind, key);
  (doc.shared[kind] as Record<string, unknown>)[key] = clone(v ?? (kind === 'lists' ? [] : ''));
  for (const sd of Object.values(doc.services)) delete (sd[kind] as Record<string, unknown>)[key];
}

/** 이 예배만: the service keeps what it shows now as its own value; the others are not touched. */
export function makeOwn(doc: CueDoc, sid: string, kind: FieldKind, key: string) {
  const v = fieldValue(doc, sid, kind, key);
  (doc.services[sid][kind] as Record<string, unknown>)[key] = clone(v ?? (kind === 'lists' ? [] : ''));
}

/** 다른 예배에서 복사: the staff of `from` becomes this service's own. */
export function copyPeople(doc: CueDoc, from: string, to: string, keys: string[]) {
  for (const k of keys) {
    const v = fieldValue(doc, from, 'people', k) ?? '';
    if (v === (fieldValue(doc, to, 'people', k) ?? '')) continue;
    if (v !== '' || k in doc.shared.people || SHARED_DEFAULT.has(k)) doc.services[to].people[k] = v;
    else delete doc.services[to].people[k];
  }
}

// ---------------- new document from an earlier one ----------------

export interface CopyParts {
  /** 출연·스태프, 보컬·인도자 Mic 수 */
  people: boolean;
  /** 순서, 시간, 시작 시간, 직접 추가한 순서 */
  order: boolean;
  /** 미리보기에서 고친 칸 */
  edits: boolean;
  /** 특별순서 켜기/끄기 */
  specials: boolean;
  /** 찬양·본문·설교제목·봉헌위원 … */
  content: boolean;
}
export const COPY_DEFAULT: CopyParts = { people: true, order: true, edits: true, specials: false, content: false };

export function copyDoc(rules: RulesFile, prev: CueDoc, date: string, parts: CopyParts, at = new Date().toISOString()): CueDoc {
  const doc = emptyDoc(rules, prev.kind, date);
  doc.updatedAt = at;
  if (parts.people) doc.shared.people = clone(prev.shared.people);
  if (parts.content) {
    doc.shared.values = clone(prev.shared.values);
    doc.shared.lists = clone(prev.shared.lists);
  }
  const custom = new Set<string>();
  for (const [sid, sd] of Object.entries(doc.services)) {
    const p = prev.services[sid];
    if (!p) continue;
    for (const m of p.moves) if (m.title != null) custom.add(m.key);
    if (parts.people) {
      sd.people = clone(p.people);
      if (p.vocals != null) sd.vocals = p.vocals;
      if (p.leaders != null) sd.leaders = p.leaders;
    }
    if (parts.content) {
      sd.values = clone(p.values);
      sd.lists = clone(p.lists);
    }
    if (parts.specials) sd.specials = clone(p.specials);
    if (parts.order) {
      sd.moves = clone(p.moves);
      sd.off = [...p.off];
      sd.durs = clone(p.durs);
      if (p.start) sd.start = p.start;
    }
  }
  if (parts.edits) {
    doc.edits = prev.edits
      .filter((e) => parts.order || !custom.has(e.row))
      .map((e) => ({ ...clone(e), id: newId(), at }));
  }
  return doc;
}
