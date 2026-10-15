import { emptyService, emptyWeek, norm } from './engine';
import { COL_LABELS, COLS } from './types';
import type { CellEdit, Col, RoleChange, ServiceInput, WeekInput } from './types';

/** Korean keys accepted in the text format. */
export const PEOPLE_KEYS = ['사회', '설교', '인도', '나래이션', 'PD', 'FD', '음향', '조명', '자막', '방송실', '카메라'];
const PEOPLE_ALIASES: Record<string, string> = { 사회자: '사회', 설교자: '설교', 인도자: '인도', 봉독: '나래이션', 봉독자: '나래이션', 나레이션: '나래이션' };
export const LIST_KEYS = ['찬양', '찬양1', '찬양2', '본문', '설교제목', '봉헌찬양', '축도찬양', '마무리찬양', '성가대찬양', '선교지', '과정', '영상목록'];
const LIST_ALIASES: Record<string, string> = { 성경본문: '본문', 성경구절: '본문', 제목: '설교제목', 봉헌곡: '봉헌찬양', 비전찬양: '봉헌찬양', 축도곡: '축도찬양', 마무리곡: '마무리찬양' };
export const VALUE_KEYS = ['봉헌위원', '분병분잔', '성찬위원', '특순', '영상이름', '파송팀', '파송인원', '수료자', '수료인원', '간증자'];
export const SPECIAL_KEYS = ['성찬식', '비전헌금', '성가대', '파송식', '수료식', '특별영상', '외부강사'];
/** A non yes/no value on a special line switches it on and fills its main parameter. */
const SPECIAL_MAIN: Record<string, { key: string; list?: boolean }> = {
  특별영상: { key: '영상이름' }, 성가대: { key: '성가대찬양', list: true }, 파송식: { key: '선교지', list: true },
  수료식: { key: '과정', list: true }, 비전헌금: { key: '특순' },
};
const YES = new Set(['예', '네', 'o', 'y', 'yes', 'true', '1', '있음', '함', 'on']);
const NO = new Set(['아니오', '아니요', 'x', 'n', 'no', 'false', '0', '없음', '안함', 'off']);
const BLOCKS = ['순서', '시간', '담당변경', '추가', '변경'];
const COL_BY_LABEL: Record<string, Col> = Object.fromEntries(
  [...COLS.map((c) => [norm(COL_LABELS[c]), c]), [norm('입출'), 'inout'], [norm('세부'), 'details'], [norm('마이크'), 'mic']],
);
const SECTION: Record<string, string> = { '1부': '1', '2부': '2', '4부': '4', p130: '4', '공통': '*' };

export function parseDate(s: string): string | null {
  const t = s.trim();
  let m = /(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/.exec(t);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

const isUrl = (s: string) => /^(https?:\/\/|www\.|youtu)/i.test(s) || /youtu\.?be/i.test(s);
const isAnnounce = (s: string) => /^-*\s*(광고|교회소식|성도의\s*교제)\s*-*$/.test(s.replace(/[-–—=]+/g, '-').trim()) || /^-{2,}.*광고.*-{2,}$/.test(s);

/**
 * Clean a pasted worship-team message: drop URLs, date headers and numbering.
 * Returns songs before / after a "-- 광고 --" divider.
 */
export function parseSongs(text: string): { before: string[]; after: string[]; hasDivider: boolean } {
  const before: string[] = [], after: string[] = [];
  let cur = before, hasDivider = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const s = rawLine.trim();
    if (!s || isUrl(s)) continue;
    if (isAnnounce(s)) { cur = after; hasDivider = true; continue; }
    if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/.test(s) && /찬양|예배|부/.test(s)) continue;
    cur.push(s.replace(/^\d+\s*[.)]\s*/, '').replace(/\s*->\s*/g, ' → '));
  }
  return { before, after, hasDivider };
}

function keyOf(k: string): { kind: 'people' | 'list' | 'value' | 'special' | 'block' | 'num' | 'date' | 'start'; key: string } | null {
  const n = norm(k);
  if (n === '날짜' || n === 'date') return { kind: 'date', key: 'date' };
  if (n === '시작' || n === '시작시간') return { kind: 'start', key: 'start' };
  if (n === '보컬' || n === '보컬수') return { kind: 'num', key: 'vocals' };
  if (n === '인도자수') return { kind: 'num', key: 'leaders' };
  for (const p of PEOPLE_KEYS) if (norm(p) === n) return { kind: 'people', key: p };
  if (PEOPLE_ALIASES[k.trim()]) return { kind: 'people', key: PEOPLE_ALIASES[k.trim()] };
  for (const p of LIST_KEYS) if (norm(p) === n) return { kind: 'list', key: p };
  for (const [a, p] of Object.entries(LIST_ALIASES)) if (norm(a) === n) return { kind: 'list', key: p };
  for (const p of VALUE_KEYS) if (norm(p) === n) return { kind: 'value', key: p };
  for (const p of SPECIAL_KEYS) if (norm(p) === n) return { kind: 'special', key: p };
  for (const p of BLOCKS) if (norm(p) === n) return { kind: 'block', key: p };
  return null;
}

const durOf = (s: string): { name: string; dur?: number } => {
  const t = s.trim();
  const m = /^(.*\S)\s*\(\s*(\d+)\s*(?:’|'|분|min)?\s*\)\s*$/.exec(t) ?? /^(.*\S)[\s,:|]+-?\s*(\d+)\s*(?:’|'|분|min)?\s*$/.exec(t);
  if (!m) return { name: t };
  const name = m[1].replace(/[\s\-–—:,|]+$/, '').trim();
  return name ? { name, dur: Number(m[2]) } : { name: t };
};

/** Tells the parser whether a whole string is a known row name (so "찬양 2" is not read as "찬양" + 2분). */
export type NameCheck = (sid: string, name: string) => boolean;

export interface ParseResult { week: WeekInput; warnings: string[] }

export function parseText(text: string, fallbackDate: string, isName: NameCheck = () => false): ParseResult {
  const warnings: string[] = [];
  const common: { line: string; n: number }[] = [];
  const sections = new Map<string, { line: string; n: number }[]>();
  let date = fallbackDate;
  let cur: string | null = null;
  text.split(/\r?\n/).forEach((line, i) => {
    const sec = /^\s*\[\s*([^\]]+?)\s*\]\s*$/.exec(line);
    if (sec) {
      const sn = norm(sec[1]);
      const id = Object.entries(SECTION).find(([k]) => sn.includes(k))?.[1];
      if (!id) { warnings.push(`${i + 1}행: 알 수 없는 구역 [${sec[1]}] — 1부, 2부, 4부, 공통 중 하나`); cur = '?'; return; }
      cur = id;
      if (id !== '*' && !sections.has(id)) sections.set(id, []);
      return;
    }
    const kv = /^\s*([^:：]+?)\s*[:：]\s*(.*)$/.exec(line);
    if (kv && keyOf(kv[1])?.kind === 'date') { const d = parseDate(kv[2]); if (d) date = d; else warnings.push(`${i + 1}행: 날짜 형식 오류`); return; }
    if (cur === '?') return;
    (cur == null || cur === '*' ? common : sections.get(cur)!).push({ line, n: i + 1 });
  });
  const week = emptyWeek(date);
  for (const sid of ['1', '2', '4']) week.services[sid] = emptyService(sections.size === 0 || sections.has(sid));
  for (const sid of ['1', '2', '4']) {
    if (!week.services[sid].include) continue;
    applyLines(week.services[sid], common, sid, warnings, isName);
    applyLines(week.services[sid], sections.get(sid) ?? [], sid, warnings, isName);
  }
  return { week, warnings: [...new Set(warnings)] };
}

function applyLines(svc: ServiceInput, lines: { line: string; n: number }[], sid: string, warnings: string[], isName: NameCheck) {
  let block: { kind: string; key: string } | null = null;
  let songs: { key: string; buf: string[] } | null = null;
  const touched = new Set<string>();
  const listPush = (key: string, items: string[]) => {
    if (!touched.has(key)) { svc.lists[key] = []; touched.add(key); }
    svc.lists[key].push(...items);
  };
  const flushSongs = () => {
    if (!songs) return;
    const { before, after, hasDivider } = parseSongs(songs.buf.join('\n'));
    if (songs.key === '찬양' && sid === '4') {
      if (!hasDivider && before.length) warnings.push('4부 찬양: "-- 광고 --" 구분선이 없어 모두 찬양1로 넣었습니다 (찬양1:, 찬양2: 로 나눠 쓰세요)');
      listPush('찬양1', before);
      if (after.length) listPush('찬양2', after);
    } else listPush(songs.key, [...before, ...after]);
    songs = null;
  };
  const isSong = (key: string) => /찬양/.test(key);
  for (const { line, n } of lines) {
    const s = line.trim();
    if (!s || s.startsWith('#') || s.startsWith('//')) continue;
    const kv = /^([^:：]+?)\s*[:：]\s*(.*)$/.exec(s);
    const k = kv ? keyOf(kv[1]) : null;
    if (k) {
      flushSongs();
      const v = kv![2].trim();
      block = null;
      switch (k.kind) {
        case 'people': svc.people[k.key] = v; break;
        case 'num': { const x = parseInt(v, 10); if (Number.isFinite(x) && x >= 0) (svc as any)[k.key] = x; else warnings.push(`${n}행: 숫자가 아님 (${kv![1]})`); break; }
        case 'start': if (/^\d{1,2}:\d{2}$/.test(v)) svc.start = v.padStart(5, '0'); else warnings.push(`${n}행: 시작 시간 형식은 HH:MM`); break;
        case 'value': svc.values[k.key] = v; break;
        case 'list':
          if (isSong(k.key)) { songs = { key: k.key, buf: v ? [v] : [] }; block = k; }
          else if (v) listPush(k.key, [v]);
          else block = k;
          break;
        case 'special': {
          const lv = v.toLowerCase();
          if (!v || YES.has(lv)) svc.specials[k.key] = true;
          else if (NO.has(lv)) svc.specials[k.key] = false;
          else if (lv === '자동' || lv === 'auto') delete svc.specials[k.key];
          else {
            svc.specials[k.key] = true;
            const main = SPECIAL_MAIN[k.key];
            if (main?.list) listPush(main.key, [v]);
            else if (main) svc.values[main.key] = v;
            else warnings.push(`${n}행: ${k.key} 값은 예/아니오`);
          }
          break;
        }
        case 'block':
          block = k;
          if (k.key === '순서') svc.order = [];
          if (v) handleBlock(svc, sid, k.key, v, n, warnings, isName);
          break;
      }
      continue;
    }
    if (songs) { songs.buf.push(s); continue; }
    if (block?.kind === 'list') { listPush(block.key, [s.replace(/^-\s*/, '')]); continue; }
    if (block?.kind === 'block') { handleBlock(svc, sid, block.key, s, n, warnings, isName); continue; }
    warnings.push(`${n}행: 알 수 없는 줄 "${s.slice(0, 30)}" — 무시됨`);
  }
  flushSongs();
}

function handleBlock(svc: ServiceInput, sid: string, key: string, s: string, n: number, warnings: string[], isName: NameCheck) {
  const bad = (msg: string) => warnings.push(`${n}행 "${s.slice(0, 30)}": ${msg}`);
  const split = (t: string) => {
    const r = durOf(t);
    // "찬양 2" in 4부 is the row 찬양 2, not 찬양 for 2 minutes
    return r.dur != null && isName(sid, t.trim()) && !isName(sid, r.name) ? { name: t.trim() } : r;
  };
  if (key === '순서') {
    const { name, dur } = split(s.replace(/^\d+\s*[.)]\s*/, ''));
    svc.order!.push(dur == null ? { ref: name } : { ref: name, dur });
  } else if (key === '시간') {
    const { name, dur } = split(s);
    if (dur == null) bad('시간 형식은 "순서이름 분" (예: 설교 30)');
    else (svc.durations ??= {})[name] = dur;
  } else if (key === '담당변경') {
    const m = /^(.+?)\s*[:|]\s*(\S+)\s*(?:->|→|=>)\s*(\S+)\s*$/.exec(s);
    if (!m) bad('담당변경 형식은 "순서이름: 사회자 -> 봉독자"');
    else (svc.roles ??= []).push({ row: m[1].trim(), from: m[2], to: m[3] });
  } else {
    const parts = s.split('|').map((x) => x.trim());
    const col = parts.length >= 3 ? COL_BY_LABEL[norm(parts[1])] : undefined;
    if (!col) { bad(`${key} 형식은 "순서이름 | 칸이름 | 내용" (칸: 내용, 담당, 음향, 화면, 조명, 입-출, 무대, 세부사항)`); return; }
    const text = parts.slice(2).join('|').trim();
    const mode = key === '추가' ? 'append' : 'replace';
    const edits = (svc.edits ??= []);
    const last = edits[edits.length - 1];
    // consecutive lines for the same row and column become one multi-line edit
    if (last && last.row === parts[0] && last.col === col && last.mode === mode) last.lines.push(text);
    else edits.push({ row: parts[0], col, mode, lines: [text] });
  }
}

/** Serialize the input back to the text format (round-trips through parseText). */
export function toText(week: WeekInput): string {
  const out: string[] = [`날짜: ${week.date}`, ''];
  for (const sid of ['1', '2', '4']) {
    const s = week.services[sid];
    if (!s?.include) continue;
    out.push(`[${sid}부]`);
    for (const k of PEOPLE_KEYS) if (s.people[k]) out.push(`${k}: ${s.people[k]}`);
    if (s.start) out.push(`시작: ${s.start}`);
    if (s.vocals != null) out.push(`보컬: ${s.vocals}`);
    if (s.leaders != null) out.push(`인도자수: ${s.leaders}`);
    for (const [k, v] of Object.entries(s.lists)) if (v.length) out.push(`${k}:`, ...v.map((x, i) => (/찬양/.test(k) ? `${i + 1}. ${x}` : x)));
    for (const [k, v] of Object.entries(s.values)) if (v) out.push(`${k}: ${v}`);
    for (const [k, v] of Object.entries(s.specials)) if (v != null) out.push(`${k}: ${v ? '예' : '아니오'}`);
    const order = (s.order ?? []).filter((e) => e.ref.trim());
    if (order.length) out.push('순서:', ...order.map((e) => (e.dur != null ? `${e.ref} ${e.dur}` : e.ref)));
    if (s.durations && Object.keys(s.durations).length) out.push('시간:', ...Object.entries(s.durations).map(([k, v]) => `${k} ${v}`));
    out.push(...editLines(s), '');
  }
  return out.join('\n');
}

/** The 담당변경 / 추가 / 변경 blocks of one service, in the text format. */
export function editLines(s: ServiceInput): string[] {
  const out: string[] = [];
  if (s.roles?.length) out.push('담당변경:', ...s.roles.map((r) => `${r.row}: ${r.from} -> ${r.to}`));
  const ed = (mode: string) => (s.edits ?? []).filter((e) => e.mode === mode).flatMap((e) => e.lines.map((l) => `${e.row} | ${COL_LABELS[e.col]} | ${l}`));
  if (ed('append').length) out.push('추가:', ...ed('append'));
  if (ed('replace').length) out.push('변경:', ...ed('replace'));
  return out;
}

/** Reads 담당변경 / 추가 / 변경 blocks written for one service (the app's advanced editor). */
export function parseEdits(sid: string, text: string, isName: NameCheck = () => false): { roles: RoleChange[]; edits: CellEdit[]; warnings: string[] } {
  const { week, warnings } = parseText(`[${sid}부]\n${text}`, '2000-01-02', isName);
  const s = week.services[sid];
  // line numbers refer to the editor, not the wrapped text
  const fixed = warnings.map((w) => w.replace(/^(\d+)행/, (_m, n: string) => `${Number(n) - 1}행`));
  return { roles: s.roles ?? [], edits: s.edits ?? [], warnings: fixed };
}
