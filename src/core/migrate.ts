import { buildSheet, guidelineRows, norm, patternMatch, rowMatches, specialRowRefs, sundayIndex } from './engine';
import { roleLinks } from './cellsave';
import { clone, computeMoves, emptyDoc, hoistShared, isBlank, newId, occasionOf, ownOnly } from './doc';
import type { CellEdit, CueDoc, Kind, RulesFile, ServiceDoc, ServiceInput, Sheet, WeekInput } from './types';

const KINDS = ['people', 'values', 'lists'] as const;
const sig = (e: CellEdit) => JSON.stringify([e.row, e.col, e.ops, e.also ?? [], e.note ?? '']);

/** Adds edits for one service; an edit that is already there (same cell, same change) gets the service added instead. */
function addEdits(doc: CueDoc, edits: CellEdit[]) {
  for (const e of edits) {
    const same = doc.edits.find((x) => sig(x) === sig(e));
    if (!same) doc.edits.push(e);
    else for (const s of e.services) if (!same.services.includes(s)) same.services.push(s);
  }
}

/**
 * Writes v1 input (text import, old saved data) into one service of `doc`: only what the input has changes. An order
 * replaces the service's order, removals and minutes. Mutates `doc`.
 */
function fillService(rules: RulesFile, doc: CueDoc, sid: string, inp: ServiceInput, at: string) {
  const svc = rules.services[sid];
  const sd: ServiceDoc = doc.services[sid];
  // an empty field in the text is nothing typed: the service shows the shared value
  for (const kind of KINDS) {
    const own = sd[kind] as Record<string, unknown>;
    for (const [k, v] of Object.entries(clone(inp[kind] ?? {}))) {
      if (isBlank(v)) delete own[k];
      else own[k] = v;
    }
  }
  for (const [k, v] of Object.entries(inp.specials ?? {})) if (v != null) sd.specials[k] = v;
  if (inp.start) sd.start = inp.start;
  if (inp.vocals != null) sd.vocals = inp.vocals;
  if (inp.leaders != null) sd.leaders = inp.leaders;

  // order: names may switch on specials (e.g. "영상 - 비전헌금", "강사소개") or name rows the guideline does not have
  const order = (inp.order ?? []).filter((e) => e.ref.trim());
  // rows the user added before (in any service, so the same row keeps one key everywhere)
  const known = new Map<string, string>();
  for (const s of [sd, ...Object.values(doc.services)]) for (const m of s.moves) if (m.title != null && !known.has(norm(m.title))) known.set(norm(m.title), m.key);
  const custom: Record<string, string> = Object.fromEntries(sd.moves.filter((m) => m.title != null).map((m) => [m.key, m.title!]));
  let rows = guidelineRows(rules, doc, sid);
  if (order.length) {
    const wk = sundayIndex(doc.date);
    const isOn = (id: string, auto: string | null) => sd.specials[id] ?? (auto === 'week1' ? wk === 1 : auto === 'week2' ? wk === 2 : false);
    let changed = false;
    for (const e of order) {
      if (rows.some((r) => rowMatches(r, e.ref))) continue;
      const pr = rows.find((r) => patternMatch(r, e.ref) != null);
      if (pr) {
        if (pr.aliasParam && !sd.values[pr.aliasParam]) sd.values[pr.aliasParam] = patternMatch(pr, e.ref)!;
        continue;
      }
      for (const sp of svc.specials) {
        if (isOn(sp.id, sp.auto)) continue;
        for (const rr of specialRowRefs(sp)) {
          const pm = patternMatch(rr, e.ref);
          if (rowMatches(rr, e.ref) || pm != null) {
            sd.specials[sp.id] = true;
            changed = true;
            if (pm != null && rr.aliasParam && !sd.values[rr.aliasParam]) sd.values[rr.aliasParam] = pm;
          }
        }
      }
    }
    if (changed) rows = guidelineRows(rules, doc, sid);
    const used = new Set<string>();
    const final: string[] = [];
    const titles: Record<string, string> = {};
    sd.durs = {};
    for (const e of order) {
      const r = rows.find((x) => !used.has(x.key) && rowMatches(x, e.ref)) ?? rows.find((x) => !used.has(x.key) && patternMatch(x, e.ref) != null);
      let key: string;
      if (r) key = r.key;
      else {
        const title = e.ref.replace(/^▶/, '').trim();
        key = known.get(norm(title)) ?? `custom:${title}`;
        if (used.has(key)) continue;
        titles[key] = custom[key] ?? title;
      }
      used.add(key);
      final.push(key);
      if (e.dur != null) sd.durs[key] = e.dur;
    }
    // cell changes of rows the user added that the new order no longer has
    for (const k of Object.keys(custom)) {
      if (titles[k] != null) continue;
      for (const ed of doc.edits) if (ed.row === k) ed.services = ed.services.filter((x) => x !== sid);
    }
    doc.edits = doc.edits.filter((ed) => ed.services.length);
    Object.keys(custom).forEach((k) => delete custom[k]);
    Object.assign(custom, titles);
    sd.off = rows.filter((r) => !used.has(r.key)).map((r) => r.key);
    sd.moves = computeMoves(rows.filter((r) => used.has(r.key)).map((r) => r.key), final, custom, sd.moves);
  }
  const keyOf = (ref: string) =>
    rows.find((x) => x.key === ref)?.key ?? rows.find((x) => rowMatches(x, ref))?.key ??
    Object.entries(custom).find(([k, t]) => k === ref || t === ref.replace(/^▶/, '').trim())?.[0];

  for (const [ref, d] of Object.entries(inp.durations ?? {})) {
    const k = keyOf(ref);
    if (k && Number.isFinite(d) && d >= 0) sd.durs[k] = d;
  }

  const edits: CellEdit[] = [];
  let pre: Sheet | null = null;
  for (const rc of inp.roles ?? []) {
    const k = keyOf(rc.row);
    if (!k || !rc.from || !rc.to) continue;
    pre ??= buildSheet(rules, doc, sid);
    const also = roleLinks(rules, pre, k, [{ from: rc.from, to: rc.to }]);
    edits.push({
      id: newId(), row: k, col: 'role', services: [sid], ops: [{ op: 'replace', line: rc.from, with: rc.to }],
      ...(also.length ? { also } : {}), at, note: `담당 변경: ${rc.from} → ${rc.to}`,
    });
  }
  for (const ed of inp.edits ?? []) {
    const k = keyOf(ed.row);
    if (!k) continue;
    edits.push({
      id: newId(), row: k, col: ed.col, services: [sid], at,
      ops: ed.mode === 'replace' ? [{ op: 'set', lines: ed.lines }] : ed.lines.map((line) => ({ op: 'append' as const, line })),
    });
  }
  if (inp.headerVideos?.length) edits.push({ id: newId(), row: 'header', col: 'videos', services: [sid], ops: [{ op: 'set', lines: inp.headerVideos }], at });
  addEdits(doc, edits);
}

/** v1 week input (text import / old saved data) → document. Fields equal in every service become the shared value. */
export function weekToDoc(rules: RulesFile, week: WeekInput, kind: Kind = 'sunday', at = new Date().toISOString()): CueDoc {
  const doc = emptyDoc(rules, kind, week.date);
  doc.updatedAt = at;
  for (const sid of occasionOf(rules, kind).services) {
    const inp = week.services[sid];
    if (inp) fillService(rules, doc, sid, inp, at);
  }
  hoistShared(rules, doc);
  return doc;
}

/** The first version's saved week as a 주일 document; null when nothing was typed in it (it makes a blank document). */
export function v1WeekDoc(rules: RulesFile, week: WeekInput, at = new Date().toISOString()): CueDoc | null {
  const doc = weekToDoc(rules, week, 'sunday', at);
  const blank = { ...emptyDoc(rules, 'sunday', doc.date), updatedAt: at };
  return JSON.stringify(doc) === JSON.stringify(blank) ? null : doc;
}

/**
 * Text import into a saved document of the same occasion and date: only what the text has changes (fields, specials,
 * start, Mic counts; an order replaces that service's order and minutes, a 시간 block only changes minutes; cell changes
 * are added). Without `base` (or for another date) the text makes a new document.
 */
export function importWeek(rules: RulesFile, base: CueDoc | null, week: WeekInput, kind: Kind = base?.kind ?? 'sunday', at = new Date().toISOString()): CueDoc {
  if (!base || base.kind !== kind || base.date !== week.date) return weekToDoc(rules, week, kind, at);
  const doc = clone(base);
  doc.updatedAt = at;
  const sids = occasionOf(rules, kind).services.filter((s) => doc.services[s]);
  const incl = sids.filter((s) => week.services[s]?.include);
  for (const sid of incl) fillService(rules, doc, sid, week.services[sid], at);
  // a value equal to the shared one shows the shared one again
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const sid of incl) {
    for (const kind of KINDS) {
      const own = doc.services[sid][kind] as Record<string, unknown>;
      const shared = doc.shared[kind] as Record<string, unknown>;
      for (const k of Object.keys(week.services[sid][kind] ?? {})) if (k in shared && !ownOnly(rules, sid, kind, k) && same(shared[k], own[k])) delete own[k];
    }
  }
  hoistShared(rules, doc);
  return doc;
}
