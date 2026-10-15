import { COL_LABELS, COLS } from './types';
import type {
  CellEdit, Col, CueDoc, EditCol, OutLine, Op, RowRule, RuleLine, RulesFile, ServiceDoc, ServiceInput, ServiceRules, Sheet,
  SheetRow, Source, SpecialRule, Warning, WeekInput,
} from './types';
import { applyMoves, clone, docServices, emptyServiceDoc, resolveFields } from './doc';
import { applyOps, outLine } from './lineops';

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export const fmtMin = (t: number) => {
  const m = ((t % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
/** Normalize a row name for matching: drop spaces and punctuation. */
export const norm = (s: string) => s.normalize('NFC').replace(/[\s/·\-–—:()（）.,▶]/g, '').toLowerCase();
/** 1 = first Sunday of the month, 2 = second, ... */
export const sundayIndex = (date: string) => Math.floor((Number(date.slice(8, 10)) - 1) / 7) + 1;
const ORDINAL = ['', '첫째', '둘째', '셋째', '넷째', '다섯째'];
/** tokens the engine fills in itself (not typed fields) */
export const COMPUTED = new Set(['vocals', 'leaders', 'timer', 'dur']);
export const TOKEN = /\{([^{}|]+)(?:\|([^{}]*))?\}/g;
export const EDIT_COL_LABELS: Record<EditCol, string> = {
  ...COL_LABELS, time: '시간', lightA: '조명 (리허설 중)', lightB: '조명 (리허설 후)', staff: '스태프', cast: '출연', mics: '체크사항 음향', videos: '체크사항 영상',
};
const addFlag = (r: { flags: string[] }, f: string) => {
  if (!r.flags.includes(f)) r.flags.push(f);
};

/** v1 input (text import) */
export function emptyService(include = true): ServiceInput {
  return { include, people: {}, values: {}, lists: {}, specials: {} };
}
export function emptyWeek(date: string): WeekInput {
  return { version: 1, date, services: { '1': emptyService(), '2': emptyService(), '4': emptyService() } };
}

interface WorkRow {
  key: string;
  name: string;
  aliases: string[];
  aliasPattern?: string;
  aliasParam?: string;
  dur: number;
  ruleDur: number | null;
  cells: Record<Col, RuleLine[]>;
  video?: string;
  shade?: string;
  source: Source;
  flags: string[];
  anchor?: string;
  special?: string;
  custom?: boolean;
}

function fromRule(r: RowRule, source: Source, special?: string): WorkRow {
  const cells = {} as Record<Col, RuleLine[]>;
  for (const c of COLS) cells[c] = clone(r.cells[c] ?? []);
  const parts = r.name.split('/').map((s) => s.trim()).filter(Boolean);
  return {
    key: r.key, name: r.name, aliases: [...new Set([...r.aliases, ...(parts.length > 1 ? parts : [])])],
    aliasPattern: r.aliasPattern, aliasParam: r.aliasParam,
    dur: r.dur, ruleDur: r.dur, cells, video: r.video, shade: r.shade, source, flags: [], ...(special ? { special } : {}),
  };
}

export function rowMatches(r: { key: string; name: string; aliases: string[] }, ref: string) {
  const n = norm(ref);
  return r.key === ref || norm(r.name) === n || r.aliases.some((a) => norm(a) === n);
}

export function patternMatch(r: { aliasPattern?: string }, ref: string): string | null {
  if (!r.aliasPattern) return null;
  const m = new RegExp(r.aliasPattern).exec(ref.trim());
  return m ? (m[1] ?? '').trim() : null;
}

/** Rows a special can add or rename, used to resolve order names that refer to a disabled special. */
export function specialRowRefs(sp: SpecialRule) {
  const out: { key: string; name: string; aliases: string[]; aliasPattern?: string; aliasParam?: string }[] = [];
  for (const op of sp.ops) {
    if (op.op === 'insertAfter' || op.op === 'replace') out.push(op.row);
    if (op.op === 'setName') out.push({ key: op.target, name: op.name, aliases: op.aliases ?? [] });
  }
  return out;
}

/** Row names a service can use in its order: its own rows, then rows its specials add or rename. */
export function rowNamesFor(rules: RulesFile, sid: string): string[] {
  const svc = rules.services[sid];
  if (!svc) return [];
  return [...new Set([...svc.rows.map((r) => r.name), ...svc.specials.flatMap(specialRowRefs).map((r) => r.name)])];
}

/** True when `name` is a row name the service knows (base rows or rows a special can add). */
export function isKnownRowName(rules: RulesFile, sid: string, name: string): boolean {
  const svc = rules.services[sid];
  if (!svc || !name.trim()) return false;
  const refs = [...svc.rows, ...svc.specials.flatMap(specialRowRefs)];
  return refs.some((r) => {
    const parts = r.name.split('/').map((x) => x.trim()).filter(Boolean);
    return rowMatches({ key: r.key, name: r.name, aliases: [...r.aliases, ...parts] }, name) || patternMatch(r, name) != null;
  });
}


interface Prepared { rows: WorkRow[]; extraMics: string[]; enabled: Map<string, boolean>; autoOn: Set<string>; warnings: Warning[] }

/** Guideline rows of a service with its specials applied (before the user's order, removals and edits). */
function prepare(rules: RulesFile, doc: CueDoc, sid: string): Prepared {
  const svc = rules.services[sid];
  const sd = doc.services[sid] ?? emptyServiceDoc();
  const { values } = resolveFields(rules, doc, sid);
  const warnings: Warning[] = [];
  const warn = (text: string, row?: string) => warnings.push({ level: 'warn', text, row });
  const info = (text: string, row?: string) => warnings.push({ level: 'info', text, row });
  const wk = sundayIndex(doc.date);
  const enabled = new Map<string, boolean>();
  const autoOn = new Set<string>();
  for (const sp of svc.specials) {
    const autoVal = sp.auto === 'week1' ? wk === 1 : sp.auto === 'week2' ? wk === 2 : false;
    if (autoVal) autoOn.add(sp.id);
    const explicit = sd.specials?.[sp.id];
    enabled.set(sp.id, explicit ?? autoVal);
    if (explicit === false && autoVal) warn(`가이드라인: ${ORDINAL[wk]} 주일은 ${sp.label} 순서가 있습니다 — 이번 주 제외로 설정됨`);
    if (explicit === true && sp.auto && !autoVal) info(`${sp.label}: 가이드라인 기본 주일(${sp.auto === 'week1' ? '첫째' : '둘째'})이 아니지만 포함됨`);
  }
  const rows: WorkRow[] = svc.rows.map((r) => fromRule(r, svc.source));
  const extraMics: string[] = [];
  const find = (key: string) => rows.findIndex((r) => r.key === key);
  for (const sp of svc.specials) {
    if (!enabled.get(sp.id)) continue;
    const tag = sp.source.kind === 'supplement' ? `${sp.label} (보완)` : sp.label;
    for (const op of sp.ops as Op[]) {
      if (op.op === 'addMic') {
        if (!op.if || values[op.if]) extraMics.push(op.mic);
        continue;
      }
      if (op.op === 'insertAfter') {
        if (rows.some((r) => r.key === op.row.key)) continue;
        const idx = find(op.anchor);
        if (idx < 0) { warn(`${sp.label}: 기준 순서 '${op.anchor}'가 없어 마지막에 추가됨`); rows.push({ ...fromRule(op.row, sp.source, sp.id), anchor: op.anchor }); continue; }
        let pos = idx + 1;
        while (pos < rows.length && rows[pos].anchor === op.anchor) pos++;
        if (pos > idx + 1) warn(`${sp.label}: '${rows[idx].name}' 뒤에 다른 특별순서와 함께 배치됨 — 순서 확인 필요`);
        rows.splice(pos, 0, { ...fromRule(op.row, sp.source, sp.id), anchor: op.anchor });
        continue;
      }
      const i = find(op.target);
      if (i < 0) { warn(`${sp.label}: 대상 순서 '${op.target}' 없음 — 규칙 일부 미적용`); continue; }
      const r = rows[i];
      switch (op.op) {
        case 'replace': rows[i] = { ...fromRule(op.row, sp.source, sp.id), anchor: r.anchor }; break;
        case 'setDur': r.dur = op.dur; r.ruleDur = op.dur; addFlag(r, `${tag}: ${op.dur}’`); break;
        case 'setCell': r.cells[op.col] = clone(op.lines); addFlag(r, `${tag}: ${COL_LABELS[op.col]}`); break;
        case 'setName':
          r.cells.content[0] = op.title; r.name = op.name;
          r.aliases = [...new Set([...r.aliases, ...(op.aliases ?? []), ...op.name.split('/').map((s) => s.trim())])];
          addFlag(r, tag); break;
        case 'move': {
          rows.splice(i, 1);
          const a = find(op.after);
          rows.splice(a < 0 ? rows.length : a + 1, 0, r);
          addFlag(r, `${tag}: 순서 이동`); break;
        }
        case 'removeLine': r.cells[op.col] = r.cells[op.col].filter((l) => l !== op.line); addFlag(r, `${tag}: 줄 삭제`); break;
        case 'addLines': {
          const at = op.at ?? r.cells[op.col].length;
          r.cells[op.col].splice(at, 0, ...clone(op.lines)); addFlag(r, `${tag}: ${COL_LABELS[op.col]}`); break;
        }
      }
    }
  }
  return { rows, extraMics, enabled, autoOn, warnings };
}

/** A service's rows after its specials, before the user's removals and order (the base for computing moves). */
export function guidelineRows(rules: RulesFile, doc: CueDoc, sid: string) {
  return prepare(rules, doc, sid).rows.map(({ key, name, aliases, aliasPattern, aliasParam, special }) => ({ key, name, aliases, aliasPattern, aliasParam, special }));
}

export interface BuildOpts {
  /** build as if these edits did not exist (to re-diff a cell the user is changing again) */
  exclude?: string[];
}

function customRow(key: string, title: string): WorkRow {
  const cells = {} as Record<Col, RuleLine[]>;
  for (const c of COLS) cells[c] = [];
  cells.content = [`▶${title}`];
  return {
    key, name: title, aliases: [], dur: 0, ruleDur: null, cells, custom: true,
    source: { kind: 'user', ref: '사용자 추가 순서' }, flags: ['가이드라인에 없는 순서'],
  };
}

function rowFields(r: WorkRow) {
  const lists = new Set<string>(), values = new Set<string>();
  const scan = (s: string) => {
    for (const m of s.matchAll(TOKEN)) if (!COMPUTED.has(m[1]) && !/^t[+-]\d+$/.test(m[1])) values.add(m[1]);
  };
  for (const c of COLS) {
    for (const l of r.cells[c]) {
      if (typeof l === 'string') scan(l);
      else if ('list' in l) lists.add(l.list);
      else { values.add(l.if); scan(l.text); }
    }
  }
  if (r.video) scan(r.video);
  return { lists: [...lists], values: [...values] };
}

export function buildSheet(rules: RulesFile, doc: CueDoc, sid: string, opts: BuildOpts = {}): Sheet {
  const svc: ServiceRules = rules.services[sid];
  const sd: ServiceDoc = doc.services[sid] ?? emptyServiceDoc();
  const { values, lists, people } = resolveFields(rules, doc, sid);
  const P = prepare(rules, doc, sid);
  const { enabled, autoOn, extraMics, warnings } = P;
  const warn = (text: string, row?: string) => warnings.push({ level: 'warn', text, row });
  const info = (text: string, row?: string) => warnings.push({ level: 'info', text, row });

  // 2. rows taken out of this service
  const off = new Set(sd.off ?? []);
  const removed = P.rows.filter((r) => off.has(r.key)).map((r) => ({ key: r.key, name: r.name }));
  for (const r of removed) info(`'${r.name}' 순서 제외됨`);
  let rows = P.rows.filter((r) => !off.has(r.key));

  // 3. the user's order and added rows
  const guidelineSeq = rows.map((r) => r.key);
  const placed = applyMoves(rows, sd.moves ?? [], (m) => customRow(m.key, m.title ?? ''));
  rows = placed.rows;
  for (const r of rows) {
    if (r.custom) warn(`'${r.name}' 은(는) 가이드라인에 없는 순서입니다 — 미리보기에서 칸을 눌러 담당/음향/조명 등을 입력하세요`, r.key);
    else if (placed.moved.has(r.key)) addFlag(r, '순서 이동');
  }
  const seq = rows.map((r) => guidelineSeq.indexOf(r.key)).filter((i) => i >= 0);
  if (seq.some((v, i) => i > 0 && v < seq[i - 1])) warn('순서가 가이드라인과 다릅니다 — 확인 필요');

  // 4. durations
  for (const [k, d] of Object.entries(sd.durs ?? {})) {
    const r = rows.find((x) => x.key === k);
    if (r && Number.isFinite(d) && d >= 0) r.dur = d;
  }
  for (const r of rows) {
    if (r.ruleDur != null && r.dur !== r.ruleDur) {
      addFlag(r, `시간 변경 (가이드라인 ${r.ruleDur}’)`);
      info(`'${r.name}' 시간 ${r.ruleDur}’ → ${r.dur}’`, r.key);
    }
  }

  // 5. times
  const start = toMin(sd.start || svc.start);
  if (sd.start && sd.start !== svc.start) warn(`시작 시간 변경: ${svc.start} → ${sd.start}`);
  let t = start;
  const starts = new Map<string, number>();
  for (const r of rows) { starts.set(r.key, t); t += r.dur; }
  const end = t;
  let timer: number | undefined;
  if (svc.timer) {
    const a = starts.get(svc.timer.from), bIdx = rows.findIndex((r) => r.key === svc.timer!.to);
    if (a != null && bIdx >= 0) timer = starts.get(svc.timer.to)! + rows[bIdx].dur - a;
    else warn('타이머 계산 기준(찬양 1, 찬양 2)이 없어 가이드라인 값 사용');
  }

  // 6. token expansion; every line remembers where it came from so a preview edit can be written back
  const vocals = sd.vocals ?? svc.defaults.vocals;
  const leaders = sd.leaders ?? svc.defaults.leaders;
  const ctx: Record<string, string> = { ...values, vocals: String(vocals), leaders: String(leaders) };
  if (timer != null) ctx.timer = String(timer);
  const missing = new Set<string>();
  const expand = (s: string, dur?: number) =>
    s.replace(TOKEN, (_m, name: string, def?: string) => {
      const rel = /^t([+-]\d+)$/.exec(name);
      if (rel) return fmtMin(start + Number(rel[1]));
      if (name === 'dur' && dur != null) return String(dur);
      const v = ctx[name];
      if (v != null && v !== '') return v;
      if (def != null && !COMPUTED.has(name)) missing.add(name);
      return def ?? '';
    }).replace(/#1-1(?!\d)/g, '#1');
  const expandLines = (ls: RuleLine[], dur?: number): OutLine[] => {
    const out: OutLine[] = [];
    for (const l of ls) {
      if (typeof l === 'string') {
        const o = outLine(expand(l, dur));
        out.push(l.includes('{') ? { ...o, src: { tpl: l } } : o);
      } else if ('list' in l) {
        let items = (lists[l.list] ?? []).map((s) => s.trim()).filter(Boolean);
        if (!items.length) { items = l.default; missing.add(l.list); }
        items.forEach((it, i) => {
          const text = l.fmt.replace('{n}', String(i + 1)).replace('{item}', it.replace(/\s*->\s*/g, ' → '));
          out.push({ ...outLine(expand(text, dur)), src: { list: l.list, i, fmt: l.fmt } });
        });
      } else if (values[l.if]) out.push({ ...outLine(expand(l.text, dur)), src: { tpl: l.text } });
    }
    return out;
  };
  const boldTitle = (ls: OutLine[] | undefined) => {
    if (ls?.[0]) ls[0] = { ...ls[0], bold: true };
  };

  const outRows: SheetRow[] = rows.map((r, i) => {
    const cells = {} as Record<Col, OutLine[]>;
    for (const c of COLS) cells[c] = expandLines(r.cells[c], r.dur);
    boldTitle(cells.content);
    const s = starts.get(r.key)!;
    const time = [fmtMin(s), `(${r.dur}’)`];
    if (i === rows.length - 1) time.push(`*${fmtMin(end)}`);
    if (r.source.kind === 'supplement') r.flags.unshift(`보완: ${r.source.note ?? r.source.ref}`);
    return {
      key: r.key, name: r.name, dur: r.dur, ruleDur: r.ruleDur, start: fmtMin(s), time, cells, source: r.source, flags: r.flags,
      fields: rowFields(r), ...(r.shade ? { shade: r.shade } : {}), ...(r.special ? { special: r.special } : {}), ...(r.custom ? { custom: true } : {}),
    };
  });

  // 7. edits made in the preview, in the order they were made
  const editStatus: Record<string, boolean> = {};
  const mine = (doc.edits ?? []).filter((e) => !opts.exclude?.includes(e.id) && e.services.includes(sid));
  const applyEdit = (e: CellEdit, get: (c: EditCol) => OutLine[] | null, set: (c: EditCol, ls: OutLine[]) => void) => {
    const cur = get(e.col);
    if (!cur) { editStatus[e.id] = false; return false; }
    const res = applyOps(cur, e.ops);
    set(e.col, res.lines);
    // the Mic·세부사항 a 담당 change also changes: one that no longer finds its line counts as not applied too
    let ok = res.ok;
    for (const a of e.also ?? []) {
      const c = get(a.col);
      const r2 = c && applyOps(c, a.ops);
      if (r2) set(a.col, r2.lines);
      if (!r2?.ok) ok = false;
    }
    editStatus[e.id] = ok;
    return true;
  };
  const asLines = (ts: string[]) => ts.map((text) => ({ text }));
  for (const e of mine) {
    if (e.row === 'rehearsal' || e.row === 'header') continue;
    const r = outRows.find((x) => x.key === e.row);
    if (!r) { editStatus[e.id] = false; continue; }
    const ok = applyEdit(e,
      (c) => (c === 'time' ? asLines(r.time) : (COLS as readonly string[]).includes(c) ? r.cells[c as Col] : null),
      (c, ls) => { if (c === 'time') r.time = ls.map((l) => l.text); else r.cells[c as Col] = ls; });
    if (!ok) continue;
    boldTitle(r.cells.content);
    addFlag(r, e.note ?? `직접 수정: ${EDIT_COL_LABELS[e.col]}`);
    if (e.note) warn(`'${r.name}' ${e.note} (가이드라인과 다름)`, r.key);
    else if (!r.custom) info(`'${r.name}' ${EDIT_COL_LABELS[e.col]} 칸 직접 수정됨`, r.key);
  }

  // 8. rehearsal
  const reh: Record<string, OutLine[]> = {};
  for (const [k, ls] of Object.entries(svc.rehearsal.cells)) reh[k] = expandLines(ls, svc.rehearsal.dur);
  boldTitle(reh.content);
  for (const m of extraMics) {
    if (!reh.mic.some((l) => l.text === m)) {
      reh.mic.push({ text: m });
      info(`리허설·체크사항 음향에 '${m}' 추가 (보완)`);
    }
  }
  let rehTime = [fmtMin(start - svc.rehearsal.dur), `(${svc.rehearsal.dur}’)`];
  for (const e of mine) {
    if (e.row !== 'rehearsal') continue;
    if (!applyEdit(e, (c) => (c === 'time' ? asLines(rehTime) : reh[c] ?? null),
      (c, ls) => { if (c === 'time') rehTime = ls.map((l) => l.text); else reh[c] = ls; })) continue;
    boldTitle(reh.content);
    info(`리허설 ${EDIT_COL_LABELS[e.col]} 칸 직접 수정됨`);
  }

  // 9. header
  const staff = rules.staffOrder.map((k) => `-${k}: ${people[k] ?? ''}`.trimEnd());
  const missingStaff = rules.staffOrder.filter((k) => !people[k]);
  if (missingStaff.length) info(`스태프 미입력: ${missingStaff.join(', ')}`);
  const cast: string[] = [];
  for (const [k, label, optional] of svc.cast) {
    if (optional && !people[k]) continue;
    if (!people[k]) warn(`출연 미입력: ${label}`);
    cast.push(`■${label}: ${people[k] ?? ''}`.trimEnd());
  }
  const mics: string[] = [];
  for (const l of reh.mic ?? []) {
    // "보컬 Mic #1-4 Band" is two header items; "Full Band" alone is one
    const m = /^(.*?\S)\s+(Full\s+Band|Band)$/.exec(l.text);
    for (const part of m && !/^full$/i.test(m[1]) ? [m[1], m[2]] : [l.text]) {
      let p = part.trim();
      if (p === '인도자 Mic') p = leaders > 1 ? `인도자 Mic #1-${leaders}` : '인도자 Mic #1';
      if (p && !mics.includes(p)) mics.push(p);
    }
  }
  mics.push('BGM');
  const videos = rows.filter((r) => r.video).map((r) => expand(r.video!));
  const header: Sheet['header'] = { staff, cast, mics, videos };
  for (const e of mine) {
    if (e.row !== 'header') continue;
    const key = e.col as keyof Sheet['header'];
    applyEdit(e, (c) => (c in header ? asLines(header[c as keyof Sheet['header']]) : null), (_c, ls) => { header[key] = ls.map((l) => l.text); });
  }

  for (const sp of svc.specials) {
    if (!enabled.get(sp.id)) continue;
    for (const n of sp.notes) warn(`${sp.label}: ${n}`);
    if (!sp.notes.length && sp.source.kind === 'supplement' && sp.source.note) warn(`${sp.label}: 가이드라인 보완 규칙 — ${sp.source.note}`);
  }
  for (const name of missing) info(`입력 없음: ${name} — 가이드라인 예시 문구 사용`);

  const [yyyy, mm, dd] = doc.date.split('-');
  const fileBase = svc.fileName.replace('{yyyy}', yyyy).replace('{mmdd}', mm + dd);
  const prep: string[] = [];
  for (const sp of svc.specials) if (enabled.get(sp.id)) for (const p of sp.prep) prep.push(`[${sp.label}] ${p}`);

  return {
    serviceId: sid, label: svc.label, title: svc.title, date: doc.date,
    dateText: `${Number(yyyy)}년 ${Number(mm)}월 ${Number(dd)}일`,
    fileBase, template: svc.template, cols: svc.cols ?? [...COLS],
    rehearsal: { time: rehTime, cells: reh },
    rows: outRows, end: fmtMin(end), header,
    specials: svc.specials.map((sp) => ({ id: sp.id, label: sp.label, enabled: !!enabled.get(sp.id), auto: autoOn.has(sp.id), source: sp.source })),
    warnings, prep, removed, editStatus,
  };
}

/** Every service of the document, in the occasion's order. */
export function buildDoc(rules: RulesFile, doc: CueDoc, opts: BuildOpts = {}): Sheet[] {
  return docServices(rules, doc).map((sid) => buildSheet(rules, doc, sid, opts));
}

/**
 * Fields a service can use (its rows and the rows and lines its specials add), with the example text the guideline
 * prints when a field is empty (input placeholders).
 */
export function fieldsFor(svc: ServiceRules) {
  const lists = new Map<string, string[]>();
  const scalars = new Map<string, string>();
  const scanText = (s: string) => {
    for (const m of s.matchAll(TOKEN)) {
      if (COMPUTED.has(m[1]) || /^t[+-]\d+$/.test(m[1])) continue;
      if (!scalars.get(m[1]) && m[2] != null) scalars.set(m[1], m[2]);
      else if (!scalars.has(m[1])) scalars.set(m[1], '');
    }
  };
  const scan = (ls: RuleLine[] | undefined) => {
    for (const l of ls ?? []) {
      if (typeof l === 'string') scanText(l);
      else if ('list' in l) { if (!lists.has(l.list)) lists.set(l.list, l.default); }
      else { scanText(l.text); if (!scalars.has(l.if)) scalars.set(l.if, ''); }
    }
  };
  const scanRow = (r: RowRule) => {
    for (const c of COLS) scan(r.cells[c]);
    if (r.video) scanText(r.video);
  };
  svc.rows.forEach(scanRow);
  for (const sp of svc.specials) {
    for (const op of sp.ops) {
      if (op.op === 'insertAfter' || op.op === 'replace') scanRow(op.row);
      else if (op.op === 'setCell' || op.op === 'addLines') scan(op.lines);
    }
  }
  return { lists, scalars };
}
