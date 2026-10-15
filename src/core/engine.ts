import { COL_LABELS, COLS } from './types';
import type {
  Col, OutLine, Op, RowRule, RuleLine, RulesFile, ServiceInput, ServiceRules, Sheet, SheetRow, Source,
  SpecialRule, Warning, WeekInput,
} from './types';

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
const COMPUTED = new Set(['vocals', 'leaders', 'timer']);
const addFlag = (r: { flags: string[] }, f: string) => {
  if (!r.flags.includes(f)) r.flags.push(f);
};

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
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function fromRule(r: RowRule, source: Source): WorkRow {
  const cells = {} as Record<Col, RuleLine[]>;
  for (const c of COLS) cells[c] = clone(r.cells[c] ?? []);
  const parts = r.name.split('/').map((s) => s.trim()).filter(Boolean);
  return {
    key: r.key, name: r.name, aliases: [...new Set([...r.aliases, ...(parts.length > 1 ? parts : [])])],
    aliasPattern: r.aliasPattern, aliasParam: r.aliasParam,
    dur: r.dur, ruleDur: r.dur, cells, video: r.video, shade: r.shade, source, flags: [],
  };
}

function rowMatches(r: { key: string; name: string; aliases: string[] }, ref: string) {
  const n = norm(ref);
  return r.key === ref || norm(r.name) === n || r.aliases.some((a) => norm(a) === n);
}

function patternMatch(r: { aliasPattern?: string }, ref: string): string | null {
  if (!r.aliasPattern) return null;
  const m = new RegExp(r.aliasPattern).exec(ref.trim());
  return m ? (m[1] ?? '').trim() : null;
}

const HANGUL = /[가-힣]/;
/** Replaces `from` where it is a whole word (not part of a longer Hangul word). No regex lookbehind: older WebKit lacks it. */
function replaceWord(s: string, from: string, to: string): string {
  let out = '', i = 0;
  for (;;) {
    const j = s.indexOf(from, i);
    if (j < 0) return out + s.slice(i);
    const whole = !HANGUL.test(s[j - 1] ?? '') && !HANGUL.test(s[j + from.length] ?? '');
    out += s.slice(i, j) + (whole ? to : from);
    i = j + from.length;
  }
}

/** Rows a special can add or rename, used to resolve order names that refer to a disabled special. */
function specialRowRefs(sp: SpecialRule) {
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

export function buildSheet(rules: RulesFile, sid: string, week: WeekInput): Sheet {
  const svc: ServiceRules = rules.services[sid];
  const input: ServiceInput = week.services[sid] ?? emptyService();
  const warnings: Warning[] = [];
  const warn = (text: string, row?: string) => warnings.push({ level: 'warn', text, row });
  const info = (text: string, row?: string) => warnings.push({ level: 'info', text, row });
  const values: Record<string, string> = { ...(input.values ?? {}) };
  const lists = input.lists ?? {};
  const people = input.people ?? {};
  const wk = sundayIndex(week.date);

  // 1. which specials are on (guideline auto rules, explicit toggles, references from the order)
  const enabled = new Map<string, boolean>();
  const autoOn = new Set<string>();
  for (const sp of svc.specials) {
    const autoVal = sp.auto === 'week1' ? wk === 1 : sp.auto === 'week2' ? wk === 2 : false;
    if (autoVal) autoOn.add(sp.id);
    const explicit = input.specials?.[sp.id];
    enabled.set(sp.id, explicit ?? autoVal);
    if (explicit === false && autoVal) warn(`가이드라인: ${ORDINAL[wk]} 주일은 ${sp.label} 순서가 있습니다 — 이번 주 제외로 설정됨`);
    if (explicit === true && sp.auto && !autoVal) info(`${sp.label}: 가이드라인 기본 주일(${sp.auto === 'week1' ? '첫째' : '둘째'})이 아니지만 포함됨`);
  }

  const build = () => {
    let rows: WorkRow[] = svc.rows.map((r) => fromRule(r, svc.source));
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
          if (idx < 0) { warn(`${sp.label}: 기준 순서 '${op.anchor}'가 없어 마지막에 추가됨`); rows.push({ ...fromRule(op.row, sp.source), anchor: op.anchor }); continue; }
          let pos = idx + 1;
          while (pos < rows.length && rows[pos].anchor === op.anchor) pos++;
          if (pos > idx + 1) warn(`${sp.label}: '${rows[idx].name}' 뒤에 다른 특별순서와 함께 배치됨 — 순서 확인 필요`);
          rows.splice(pos, 0, { ...fromRule(op.row, sp.source), anchor: op.anchor });
          continue;
        }
        const i = find(op.target);
        if (i < 0) { warn(`${sp.label}: 대상 순서 '${op.target}' 없음 — 규칙 일부 미적용`); continue; }
        const r = rows[i];
        switch (op.op) {
          case 'replace': rows[i] = { ...fromRule(op.row, sp.source), anchor: r.anchor }; break;
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
    return { rows, extraMics };
  };

  let { rows, extraMics } = build();

  // 2. explicit order (authoritative). Names may switch on specials (e.g. "영상 - 비전헌금", "강사소개").
  const order = (input.order ?? []).filter((e) => e.ref.trim());
  if (order.length) {
    let changed = false;
    for (const e of order) {
      if (rows.some((r) => rowMatches(r, e.ref))) continue;
      const pr = rows.find((r) => patternMatch(r, e.ref) != null);
      if (pr) { if (pr.aliasParam && !values[pr.aliasParam]) values[pr.aliasParam] = patternMatch(pr, e.ref)!; continue; }
      for (const sp of svc.specials) {
        if (enabled.get(sp.id)) continue;
        for (const rr of specialRowRefs(sp)) {
          const pm = patternMatch(rr, e.ref);
          if (rowMatches(rr, e.ref) || pm != null) {
            enabled.set(sp.id, true); changed = true;
            info(`순서의 '${e.ref}' → 특별순서 '${sp.label}' 포함`);
            if (pm != null && rr.aliasParam && !values[rr.aliasParam]) values[rr.aliasParam] = pm;
          }
        }
      }
    }
    if (changed) ({ rows, extraMics } = build());
    const guidelineSeq = rows.map((r) => r.key);
    const used = new Set<string>();
    const next: WorkRow[] = [];
    for (const e of order) {
      const r = rows.find((x) => !used.has(x.key) && rowMatches(x, e.ref)) ?? rows.find((x) => !used.has(x.key) && patternMatch(x, e.ref) != null);
      if (r) {
        used.add(r.key); next.push(r);
        if (e.dur != null) r.dur = e.dur;
      } else {
        const title = e.ref.replace(/^▶/, '').trim();
        const key = `custom:${title}`;
        if (used.has(key)) { warn(`순서 '${e.ref}' 중복 — 무시됨`); continue; }
        used.add(key);
        const cells = {} as Record<Col, RuleLine[]>;
        for (const c of COLS) cells[c] = [];
        cells.content = [`▶${title}`];
        next.push({ key, name: title, aliases: [], dur: e.dur ?? 0, ruleDur: null, cells, source: { kind: 'user', ref: '사용자 추가 순서' }, flags: ['가이드라인에 없는 순서'] });
        warn(`'${title}' 은(는) 가이드라인에 없는 순서입니다 — 담당/음향/조명 등을 직접 입력하세요`, key);
      }
    }
    for (const r of rows) if (!used.has(r.key)) warn(`'${r.name}' 순서가 입력한 순서에 없어 제외됨`, r.key);
    const seq = next.map((r) => guidelineSeq.indexOf(r.key)).filter((i) => i >= 0);
    if (seq.some((v, i) => i > 0 && v < seq[i - 1])) warn('입력한 순서가 가이드라인 순서와 다릅니다 — 확인 필요');
    rows = next;
  }

  // 3. duration overrides
  for (const [k, d] of Object.entries(input.durations ?? {})) {
    const r = rows.find((x) => x.key === k) ?? rows.find((x) => rowMatches(x, k));
    if (!r) warn(`시간 변경 대상 '${k}' 없음 — 무시됨`);
    else if (Number.isFinite(d) && d >= 0) r.dur = d;
  }
  for (const r of rows) {
    if (r.ruleDur != null && r.dur !== r.ruleDur) {
      addFlag(r, `시간 변경 (가이드라인 ${r.ruleDur}’)`);
      info(`'${r.name}' 시간 ${r.ruleDur}’ → ${r.dur}’`, r.key);
    }
  }

  // 4. role reassignments
  for (const rc of input.roles ?? []) {
    const r = rows.find((x) => x.key === rc.row) ?? rows.find((x) => rowMatches(x, rc.row));
    if (!r) { warn(`담당 변경 대상 '${rc.row}' 없음 — 무시됨`); continue; }
    if (!rc.from || !rc.to) continue;
    const sub = (l: RuleLine, f: (s: string) => string): RuleLine =>
      typeof l === 'string' ? f(l) : 'text' in l ? { ...l, text: f(l.text) } : l;
    r.cells.role = r.cells.role.map((l) => sub(l, (s) => (s === rc.from ? rc.to : s)));
    const mf = svc.roleMics[rc.from], mt = svc.roleMics[rc.to];
    if (mf && mt) r.cells.mic = r.cells.mic.map((l) => sub(l, (s) => s.split(mf).join(mt)));
    r.cells.details = r.cells.details.map((l) => sub(l, (s) => replaceWord(s, rc.from, rc.to)));
    addFlag(r, `담당 변경: ${rc.from} → ${rc.to}`);
    warn(`'${r.name}' 담당 변경: ${rc.from} → ${rc.to} (가이드라인과 다름)`, r.key);
  }

  // 5. direct cell edits
  for (const ed of input.edits ?? []) {
    const r = rows.find((x) => x.key === ed.row) ?? rows.find((x) => rowMatches(x, ed.row));
    if (!r) { warn(`수정 대상 순서 '${ed.row}' 없음 — 무시됨`); continue; }
    const lines = ed.lines.map((s) => s);
    r.cells[ed.col] = ed.mode === 'replace' ? lines : [...r.cells[ed.col], ...lines];
    addFlag(r, `직접 수정: ${COL_LABELS[ed.col]}`);
    if (r.source.kind !== 'user') info(`'${r.name}' ${COL_LABELS[ed.col]} 칸 직접 수정됨`, r.key);
  }

  // 6. times
  const start = toMin(input.start || svc.start);
  if (input.start && input.start !== svc.start) warn(`시작 시간 변경: ${svc.start} → ${input.start}`);
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

  // 7. token expansion
  const vocals = input.vocals ?? svc.defaults.vocals;
  const leaders = input.leaders ?? svc.defaults.leaders;
  const ctx: Record<string, string> = { ...values, vocals: String(vocals), leaders: String(leaders) };
  if (timer != null) ctx.timer = String(timer);
  const missing = new Set<string>();
  const expand = (s: string) =>
    s.replace(/\{([^{}|]+)(?:\|([^{}]*))?\}/g, (_m, name: string, def?: string) => {
      const rel = /^t([+-]\d+)$/.exec(name);
      if (rel) return fmtMin(start + Number(rel[1]));
      const v = ctx[name];
      if (v != null && v !== '') return v;
      if (def != null && !COMPUTED.has(name)) missing.add(name);
      return def ?? '';
    }).replace(/#1-1(?!\d)/g, '#1');
  const line = (s: string, bold = false): OutLine => (s.startsWith('**') ? { text: s.slice(2), bold: true } : { text: s, bold });
  const expandLines = (ls: RuleLine[]): OutLine[] => {
    const out: OutLine[] = [];
    for (const l of ls) {
      if (typeof l === 'string') out.push(line(expand(l)));
      else if ('list' in l) {
        let items = (lists[l.list] ?? []).map((s) => s.trim()).filter(Boolean);
        if (!items.length) { items = l.default; missing.add(l.list); }
        items.forEach((it, i) => out.push(line(expand(l.fmt.replace('{n}', String(i + 1)).replace('{item}', it.replace(/\s*->\s*/g, ' → '))))));
      } else if (values[l.if]) out.push(line(expand(l.text)));
    }
    return out;
  };

  const outRows: SheetRow[] = rows.map((r, i) => {
    const cells = {} as Record<Col, OutLine[]>;
    for (const c of COLS) cells[c] = expandLines(r.cells[c]);
    if (cells.content[0]) cells.content[0] = { text: cells.content[0].text, bold: true };
    const s = starts.get(r.key)!;
    const time = [fmtMin(s), `(${r.dur}’)`];
    if (i === rows.length - 1) time.push(`*${fmtMin(end)}`);
    if (r.source.kind === 'supplement') r.flags.unshift(`보완: ${r.source.note ?? r.source.ref}`);
    return { key: r.key, name: r.name, dur: r.dur, ruleDur: r.ruleDur, start: fmtMin(s), time, cells, source: r.source, flags: r.flags, ...(r.shade ? { shade: r.shade } : {}) };
  });

  // rehearsal
  const rc = svc.rehearsal.cells;
  const reh: Record<string, OutLine[]> = {};
  for (const [k, ls] of Object.entries(rc)) reh[k] = expandLines(ls);
  if (reh.content?.[0]) reh.content[0].bold = true;
  for (const m of extraMics) {
    if (!reh.mic.some((l) => l.text === m)) {
      reh.mic.push({ text: m });
      info(`리허설·체크사항 음향에 '${m}' 추가 (보완)`);
    }
  }

  // header
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
      let m = part.trim();
      if (m === '인도자 Mic') m = leaders > 1 ? `인도자 Mic #1-${leaders}` : '인도자 Mic #1';
      if (m && !mics.includes(m)) mics.push(m);
    }
  }
  mics.push('BGM');
  const videos = input.headerVideos?.length ? input.headerVideos : rows.filter((r) => r.video).map((r) => expand(r.video!));

  for (const sp of svc.specials) {
    if (!enabled.get(sp.id)) continue;
    for (const n of sp.notes) warn(`${sp.label}: ${n}`);
    if (!sp.notes.length && sp.source.kind === 'supplement' && sp.source.note) warn(`${sp.label}: 가이드라인 보완 규칙 — ${sp.source.note}`);
  }
  for (const name of missing) info(`입력 없음: ${name} — 가이드라인 예시 문구 사용`);

  const [yyyy, mm, dd] = week.date.split('-');
  const fileBase = svc.fileName.replace('{yyyy}', yyyy).replace('{mmdd}', mm + dd);
  const prep: string[] = [];
  for (const sp of svc.specials) if (enabled.get(sp.id)) for (const p of sp.prep) prep.push(`[${sp.label}] ${p}`);

  return {
    serviceId: sid, label: svc.label, title: svc.title, date: week.date,
    dateText: `${Number(yyyy)}년 ${Number(mm)}월 ${Number(dd)}일`,
    fileBase, template: svc.template,
    rehearsal: { time: [fmtMin(start - svc.rehearsal.dur), `(${svc.rehearsal.dur}’)`], cells: reh },
    rows: outRows, end: fmtMin(end),
    header: { staff, cast, mics, videos },
    specials: svc.specials.map((sp) => ({ id: sp.id, label: sp.label, enabled: !!enabled.get(sp.id), auto: autoOn.has(sp.id), source: sp.source })),
    warnings, prep,
  };
}

export function buildWeek(rules: RulesFile, week: WeekInput): Sheet[] {
  return Object.keys(rules.services)
    .filter((sid) => week.services[sid]?.include)
    .map((sid) => buildSheet(rules, sid, week));
}

/** Form fields used by a service's rows: list tokens and scalar tokens (for the UI). */
export function fieldsFor(svc: ServiceRules) {
  const lists = new Map<string, string[]>();
  const scalars = new Map<string, string>();
  const scan = (ls: RuleLine[] | undefined) => {
    for (const l of ls ?? []) {
      if (typeof l === 'string') {
        for (const m of l.matchAll(/\{([^{}|]+)\|([^{}]*)\}/g)) if (!COMPUTED.has(m[1]) && !/^t[+-]/.test(m[1])) scalars.set(m[1], m[2]);
      } else if ('list' in l) lists.set(l.list, l.default);
    }
  };
  for (const r of svc.rows) for (const c of COLS) scan(r.cells[c]);
  return { lists, scalars };
}
