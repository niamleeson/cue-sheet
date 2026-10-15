import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import rulesJson from '../rules/rules.json';
import { writeDocx } from '../core/docx';
import type { XmlImpl } from '../core/docx';
import { emptyService, emptyWeek, isKnownRowName } from '../core/engine';
import { COLS } from '../core/types';
import type { RulesFile, ServiceInput, Sheet, WeekInput } from '../core/types';
import { templateBytes } from './templates';

export const rules = rulesJson as unknown as RulesFile;
/** Every service id of the rules: 1부, 2부, 4부, then the events'. */
const SIDS = Object.keys(rules.services);
/** Sunday sheets print on one page (the church's templates); an event's program may run longer. */
export const ONE_PAGE = new Set(rules.occasions.find((o) => o.id === 'sunday')?.services ?? []);
export const isName = (sid: string, n: string) => isKnownRowName(rules, sid, n);
/** Same XML implementation as the tests, so the app writes exactly what was verified against Word. */
export const XML = { DOMParser, XMLSerializer } as unknown as XmlImpl;

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
export type Mut<T> = (draft: T) => void;

// ---------- dates ----------
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parts = (date: string) => date.split('-').map(Number);
export const isValidDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = parts(s);
  return ymd(new Date(y, m - 1, d)) === s;
};
/** Today if it is Sunday, otherwise the coming Sunday. */
function upcomingSunday(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return ymd(d);
}
export function addDays(date: string, n: number): string {
  const [y, m, d] = parts(date);
  return ymd(new Date(y, m - 1, d + n));
}
export const weekdayOf = (date: string) => {
  const [y, m, d] = parts(date);
  return new Date(y, m - 1, d).getDay();
};

// ---------- persistence ----------
const FOLDER_KEY = 'cuesheet.folder';

export const lastFolder = () => localStorage.getItem(FOLDER_KEY) ?? undefined;
export const rememberFolder = (p: string) => localStorage.setItem(FOLDER_KEY, p);

/** Validates a v0.1 input file (or v0.1's autosave) and fills in anything missing. */
export function normalizeWeek(x: unknown): WeekInput {
  const o = x as { date?: unknown; services?: Record<string, unknown> } | null;
  if (!o || typeof o !== 'object' || !o.services || typeof o.services !== 'object') throw new Error('큐시트 입력 파일이 아닙니다');
  const week = emptyWeek(typeof o.date === 'string' && isValidDate(o.date) ? o.date : upcomingSunday());
  for (const sid of SIDS) {
    const s = o.services[sid];
    week.services[sid] = s && typeof s === 'object' ? normalizeService(s as Record<string, unknown>) : emptyService(false);
  }
  return week;
}

function normalizeService(s: Record<string, any>): ServiceInput {
  const strings = (v: unknown) => Object.fromEntries(Object.entries(v ?? {}).filter(([, x]) => typeof x === 'string')) as Record<string, string>;
  const lists = (v: unknown) =>
    Object.fromEntries(Object.entries(v ?? {}).filter(([, x]) => Array.isArray(x)).map(([k, x]) => [k, (x as unknown[]).map(String)]));
  const out: ServiceInput = { include: s.include !== false, people: strings(s.people), values: strings(s.values), lists: lists(s.lists), specials: {} };
  for (const [k, v] of Object.entries(s.specials ?? {})) if (typeof v === 'boolean') out.specials[k] = v;
  if (typeof s.start === 'string' && /^\d{2}:\d{2}$/.test(s.start)) out.start = s.start;
  if (Number.isInteger(s.vocals) && s.vocals >= 0) out.vocals = s.vocals;
  if (Number.isInteger(s.leaders) && s.leaders >= 0) out.leaders = s.leaders;
  if (Array.isArray(s.order)) {
    out.order = s.order
      .filter((e: any) => e && typeof e.ref === 'string')
      .map((e: any) => (Number.isFinite(e.dur) ? { ref: e.ref, dur: e.dur } : { ref: e.ref }));
  }
  if (s.durations && typeof s.durations === 'object') {
    const d = Object.entries(s.durations).filter(([, v]) => Number.isFinite(v));
    if (d.length) out.durations = Object.fromEntries(d) as Record<string, number>;
  }
  if (Array.isArray(s.roles)) out.roles = s.roles.filter((r: any) => r && [r.row, r.from, r.to].every((v) => typeof v === 'string'));
  if (Array.isArray(s.edits)) {
    out.edits = s.edits
      .filter((e: any) => e && typeof e.row === 'string' && (COLS as readonly string[]).includes(e.col) && (e.mode === 'replace' || e.mode === 'append') && Array.isArray(e.lines))
      .map((e: any) => ({ row: e.row, col: e.col, mode: e.mode, lines: e.lines.map(String) }));
  }
  if (Array.isArray(s.headerVideos)) out.headerVideos = s.headerVideos.map(String);
  return out;
}

// ---------- output ----------
export async function makeDocx(sheet: Sheet) {
  const tpl = await templateBytes(sheet.serviceId, sheet.template);
  return writeDocx(tpl, sheet, XML, { onePage: ONE_PAGE.has(sheet.serviceId) });
}
