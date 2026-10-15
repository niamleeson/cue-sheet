import { describe, expect, it } from 'vitest';
import raw from '../src/rules/guideline-raw.json';
import rulesJson from '../src/rules/rules.json';
import { buildSheet, emptyWeek } from '../src/core/engine';
import { COLS } from '../src/core/types';
import type { OutLine, RulesFile, Sheet, SheetRow } from '../src/core/types';

const rules = rulesJson as unknown as RulesFile;
/** bold: 1 every character bold, 0 none, 2 only some; fill: cell shading */
type RawCell = { paras: string[]; span: number; vm: string | null; bold: number[]; fill: string | null };
const tables = new Map<number, RawCell[][]>(
  (raw as any[]).filter((x) => x.k === 'tbl').map((x) => [x.i as number, x.rows as RawCell[][]]),
);

/** Guideline cell → comparable lines (trim, drop empty ends, unify the minute mark). */
const nl = (c: RawCell, time = false) => {
  const ls = c.paras.map((p) => p.trim());
  while (ls.length && !ls[0]) ls.shift();
  while (ls.length && !ls[ls.length - 1]) ls.pop();
  return time ? ls.map((s) => s.replace(/'/g, '’')) : ls;
};
/**
 * Guideline cell → comparable lines with their bold flag. Two guideline quirks are normalised the
 * way the real cue sheets write them: a line where only the leading "-" is bold is regular, and
 * every ▶ title is bold (4부 ▶설교 is the one title the guideline leaves regular).
 */
const nlb = (c: RawCell) => {
  const ls = c.paras.map((p, i) => ({ text: p.trim(), bold: c.bold[i] === 1 }));
  while (ls.length && !ls[0].text) ls.shift();
  while (ls.length && !ls[ls.length - 1].text) ls.pop();
  return ls.map((l) => ({ text: l.text, bold: l.bold || l.text.startsWith('▶') }));
};
const lb = (ls: OutLine[]) => ls.map((l) => ({ text: l.text, bold: !!l.bold }));
const exp = (r: RawCell[], skipTime = false) => ({
  time: skipTime ? undefined : nl(r[0], true),
  cells: r.slice(1, 9).map((c) => nlb(c)),
  shade: r[1].fill ?? null,
});
const act = (row: SheetRow, skipTime = false) => ({
  time: skipTime ? undefined : row.time,
  cells: COLS.map((c) => lb(row.cells[c])),
  shade: row.shade ?? null,
});
const sheet = (sid: string, date = '2026-10-18', patch: (w: ReturnType<typeof emptyWeek>) => void = () => {}): Sheet => {
  const w = emptyWeek(date);
  patch(w);
  return buildSheet(rules, sid, w);
};
const row = (s: Sheet, key: string) => {
  const r = s.rows.find((x) => x.key === key);
  if (!r) throw new Error(`row ${key} missing: ${s.rows.map((x) => x.key)}`);
  return r;
};

describe('guideline fidelity: base services reproduce tables 1-3 exactly', () => {
  for (const sid of ['1', '2', '4']) {
    it(`${sid}부`, () => {
      const t = tables.get(rules.services[sid].guidelineTable)!;
      const s = sheet(sid);
      // rehearsal (rows 1-2, light split across the two rows)
      expect(s.rehearsal.time).toEqual(nl(t[1][0], true));
      const rc = s.rehearsal.cells;
      expect([rc.content, rc.role, rc.mic, rc.screen, rc.lightA, rc.inout, rc.stage, rc.details].map(lb))
        .toEqual(t[1].slice(1, 9).map((c) => nlb(c)));
      expect(lb(rc.lightB)).toEqual(nlb(t[2][5]));
      // service rows
      const body = t.slice(3);
      expect(s.rows.length).toBe(body.length);
      body.forEach((r, i) => expect(act(s.rows[i])).toEqual(exp(r)));
      // no deviation warnings for the plain guideline week
      expect(s.warnings.filter((w) => w.level === 'warn' && !w.text.startsWith('출연'))).toEqual([]);
    });
  }
});

describe('guideline fidelity: special orders reproduce their tables', () => {
  it('성가대 (표 7): 1부 07:44, 5’', () => {
    const s = sheet('1', '2026-10-18', (w) => { w.services['1'].specials['성가대'] = true; });
    expect(act(row(s, 'choir'))).toEqual(exp(tables.get(7)![0]));
    expect(row(s, 'reading').start).toBe('07:49');
    expect(s.rehearsal.cells.mic.map((l) => l.text)).toContain('성가대 Mic');
  });
  it('파송식 1부 (표 8)', () => {
    const s = sheet('1', '2026-10-18', (w) => { w.services['1'].specials['파송식'] = true; });
    const t = tables.get(8)!;
    expect(act(row(s, 'bible'))).toEqual(exp(t[0]));
    expect(act(row(s, 'mission'))).toEqual(exp(t[1]));
    expect(s.rows[s.rows.findIndex((r) => r.key === 'mission') + 1].key).toBe('announce');
  });
  it('파송식 2부 (표 9)', () => {
    const s = sheet('2', '2026-10-18', (w) => { w.services['2'].specials['파송식'] = true; });
    const t = tables.get(9)!;
    expect(act(row(s, 'fellowship'))).toEqual(exp(t[0]));
    expect(act(row(s, 'mission'))).toEqual(exp(t[1]));
    expect(s.rows[s.rows.findIndex((r) => r.key === 'mission') + 1].key).toBe('announce');
  });
  it('성찬식 (표 5): first Sunday turns it on automatically, after 설교', () => {
    for (const sid of ['1', '2']) {
      const s = sheet(sid, '2026-10-04');
      const i = s.rows.findIndex((r) => r.key === 'communion');
      expect(s.rows[i - 1].key).toBe('sermon');
      expect(act(s.rows[i], true)).toEqual(exp(tables.get(5)![0], true));
      expect(s.rows[i].dur).toBe(8);
    }
    expect(sheet('4', '2026-10-04').rows.some((r) => r.key === 'communion')).toBe(true);
  });
  it('비전헌금 2부 (표 6): second Sunday, video after 설교 then 비전/봉헌 찬양', () => {
    const s = sheet('2', '2026-10-11');
    const t = tables.get(6)!;
    const i = s.rows.findIndex((r) => r.key === 'visionvideo');
    expect(s.rows[i - 1].key).toBe('sermon');
    expect(act(s.rows[i], true)).toEqual(exp(t[0], true));
    expect(act(s.rows[i + 1], true)).toEqual(exp(t[1], true));
    expect([s.rows[i].dur, s.rows[i + 1].dur]).toEqual([2, 6]);
  });
  it('특별영상 2부 (표 10): after 성도의 교제', () => {
    const s = sheet('2', '2026-10-18', (w) => { w.services['2'].specials['특별영상'] = true; });
    const i = s.rows.findIndex((r) => r.key === 'specialvideo');
    expect(s.rows[i - 1].key).toBe('fellowship');
    expect(act(s.rows[i], true)).toEqual(exp(tables.get(10)![0], true));
  });
  it('특별영상 1부: after 공동체 성경읽기', () => {
    const s = sheet('1', '2026-10-18', (w) => { w.services['1'].specials['특별영상'] = true; });
    expect(s.rows[s.rows.findIndex((r) => r.key === 'specialvideo') - 1].key).toBe('reading');
  });
  it('외부강사 (표 11, 12)', () => {
    const one = sheet('1', '2026-10-18', (w) => { w.services['1'].specials['외부강사'] = true; });
    const k1 = one.rows.map((r) => r.key);
    expect(k1.indexOf('announce')).toBe(k1.indexOf('fellowship') + 1);
    expect(k1.indexOf('bible')).toBe(k1.indexOf('announce') + 1);
    expect(k1.indexOf('speaker')).toBe(k1.indexOf('bible') + 1);
    expect(k1.indexOf('sermon')).toBe(k1.indexOf('speaker') + 1);
    for (const sid of ['2', '4']) {
      const s = sheet(sid, '2026-10-18', (w) => { w.services[sid].specials['외부강사'] = true; });
      const k = s.rows.map((r) => r.key);
      expect(k.indexOf('speaker')).toBe(k.indexOf('bible') + 1);
      expect(k.indexOf('sermon')).toBe(k.indexOf('speaker') + 1);
    }
  });
  it('disabling an automatic special is flagged', () => {
    const s = sheet('2', '2026-10-04', (w) => { w.services['2'].specials['성찬식'] = false; });
    expect(s.rows.some((r) => r.key === 'communion')).toBe(false);
    expect(s.warnings.some((w) => w.level === 'warn' && w.text.includes('성찬식'))).toBe(true);
  });
});
