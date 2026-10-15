import { describe, expect, it } from 'vitest';
import raw from '../src/rules/guideline-raw.json';
import rulesJson from '../src/rules/rules.json';
import { buildDoc, buildSheet, emptyWeek, guidelineRows } from '../src/core/engine';
import { applyMoves, computeMoves, emptyDoc, hoistShared } from '../src/core/doc';
import { applyOps } from '../src/core/lineops';
import { importWeek, weekToDoc } from '../src/core/migrate';
import type { CellEdit, Kind, OutLine, RulesFile } from '../src/core/types';

const rules = rulesJson as unknown as RulesFile;
const text = (ls: OutLine[]) => ls.map((l) => l.text);
const L = (...t: string[]): OutLine[] => t.map((text) => ({ text }));

describe('applyOps', () => {
  it('changes lines by their text and reports anchors that are gone', () => {
    const base = [{ text: '▶설교', bold: true }, { text: '- 본문' }, { text: '- 제목' }];
    const r = applyOps(base, [
      { op: 'replace', line: '▶설교', with: '▶말씀' },
      { op: 'insert', after: '- 본문', line: '- 추가' },
      { op: 'remove', line: '-   제목 ' },
      { op: 'append', line: '**끝' },
    ]);
    expect(r.ok).toBe(true);
    expect(r.lines).toEqual([{ text: '▶말씀', bold: true }, { text: '- 본문' }, { text: '- 추가' }, { text: '끝', bold: true }]);
    expect(applyOps(base, [{ op: 'remove', line: '없는 줄' }]).ok).toBe(false);
    expect(applyOps(base, [{ op: 'insert', after: null, line: '처음' }]).lines[0].text).toBe('처음');
  });
  it('sub replaces whole words only', () => {
    const r = applyOps(L('-사회자 등단', '-사회자석 정리'), [{ op: 'sub', from: '사회자', to: '봉독자' }]);
    expect(text(r.lines)).toEqual(['-봉독자 등단', '-사회자석 정리']);
    expect(applyOps(L('a'), [{ op: 'sub', from: 'x', to: 'y' }]).ok).toBe(false);
  });
});

describe('moves', () => {
  // deterministic PRNG so failures reproduce
  let seed = 7;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
  it('computeMoves + applyMoves reproduce any order (property)', () => {
    for (let trial = 0; trial < 500; trial++) {
      const n = 1 + rnd(12);
      const base = Array.from({ length: n }, (_, i) => `r${i}`);
      const final = base.filter(() => rnd(5) > 0);
      for (let i = final.length - 1; i > 0; i--) { const j = rnd(i + 1); [final[i], final[j]] = [final[j], final[i]]; }
      const titles: Record<string, string> = {};
      for (let c = rnd(3); c > 0; c--) { const k = `custom:${trial}-${c}`; titles[k] = k; final.splice(rnd(final.length + 1), 0, k); }
      const kept = base.filter((k) => final.includes(k));
      const moves = computeMoves(kept, final, titles, []);
      const out = applyMoves(kept.map((key) => ({ key })), moves, (m) => ({ key: m.key }));
      expect(out.rows.map((r) => r.key)).toEqual(final);
      // a minimal set: rows already in guideline order do not move
      const inOrder = final.filter((k) => !titles[k]).every((k, i, a) => i === 0 || base.indexOf(a[i - 1]) < base.indexOf(k));
      if (inOrder) expect(moves.filter((m) => !m.title)).toEqual([]);
    }
  });
  it('a moved special row returns to its place when it is switched on again', () => {
    const moves = computeMoves(['a', 'b', 'x', 'c'], ['x', 'a', 'b', 'c'], {}, []);
    expect(moves.map((m) => m.key)).toEqual(['x']);
    // x is switched off, then the rest is reordered
    const kept = computeMoves(['a', 'b', 'c'], ['a', 'c', 'b'], {}, moves);
    expect(kept.some((m) => m.key === 'x')).toBe(true);
    expect(applyMoves([{ key: 'a' }, { key: 'b' }, { key: 'x' }, { key: 'c' }], kept, (m) => ({ key: m.key })).rows.map((r) => r.key))
      .toEqual(['x', 'a', 'c', 'b']);
  });
});

describe('document', () => {
  it('one document makes every service of the day; shared fields apply to all', () => {
    const doc = emptyDoc(rules, 'sunday', '2026-10-18');
    doc.shared.people['설교'] = '홍길동 목사';
    doc.services['4'].people['사회'] = '김사회 목사';
    const [s1, s2, s4] = buildDoc(rules, doc);
    expect([s1, s2, s4].map((s) => s.header.cast.find((c) => c.startsWith('■설교')))).toEqual(Array(3).fill('■설교: 홍길동 목사'));
    expect(s4.header.cast[0]).toBe('■사회: 김사회 목사');
    expect(s1.header.cast[1]).toBe('■사회:');
    doc.services['2'].people['설교'] = '이목사';
    const preacher = (sid: string) => buildSheet(rules, doc, sid).header.cast.find((c) => c.startsWith('■설교'));
    expect(preacher('2')).toBe('■설교: 이목사');
    expect(preacher('1')).toBe('■설교: 홍길동 목사');
  });

  it('order: removed rows, user rows and moves', () => {
    const doc = emptyDoc(rules, 'sunday', '2026-10-18');
    const sd = doc.services['4'];
    const base = guidelineRows(rules, doc, '4').map((r) => r.key);
    sd.off = ['fellowship'];
    const kept = base.filter((k) => k !== 'fellowship');
    const final = [...kept];
    final.splice(final.indexOf('sermon'), 0, 'custom:x');
    [final[1], final[2]] = [final[2], final[1]];
    sd.moves = computeMoves(kept, final, { 'custom:x': '간증' }, []);
    sd.durs['custom:x'] = 4;
    const s = buildSheet(rules, doc, '4');
    expect(s.rows.map((r) => r.key)).toEqual(final);
    expect(s.removed).toEqual([{ key: 'fellowship', name: expect.any(String) }]);
    const c = s.rows.find((r) => r.key === 'custom:x')!;
    expect([c.custom, c.dur, c.cells.content[0]]).toEqual([true, 4, { text: '▶간증', bold: true }]);
    expect(s.warnings.some((w) => w.text.startsWith('순서가 가이드라인과 다릅니다'))).toBe(true);
    expect(s.rows.find((r) => r.key === final[1])!.flags).toContain('순서 이동');
  });

  it('cell edits: per service scope, exclude, status', () => {
    const doc = emptyDoc(rules, 'sunday', '2026-10-18');
    const ed: CellEdit = { id: 'e1', row: 'sermon', col: 'details', services: ['1', '4'], ops: [{ op: 'append', line: '-새 줄' }], at: '' };
    const gone: CellEdit = { id: 'e2', row: 'sermon', col: 'details', services: ['4'], ops: [{ op: 'remove', line: '없는 줄' }], at: '' };
    doc.edits = [ed, gone];
    const [s1, s2, s4] = buildDoc(rules, doc);
    const d = (s: typeof s1) => text(s.rows.find((r) => r.key === 'sermon')!.cells.details);
    expect(d(s1)).toContain('-새 줄');
    expect(d(s2)).not.toContain('-새 줄');
    expect(d(s4)).toContain('-새 줄');
    expect(s4.editStatus).toEqual({ e1: true, e2: false });
    expect(d(buildSheet(rules, doc, '4', { exclude: ['e1'] }))).not.toContain('-새 줄');
    expect(s4.rows.find((r) => r.key === 'sermon')!.flags).toContain('직접 수정: 세부사항');
  });

  it('header and rehearsal edits; header mics follow the edited rehearsal sound cell', () => {
    const doc = emptyDoc(rules, 'sunday', '2026-10-18');
    doc.edits = [
      { id: 'a', row: 'rehearsal', col: 'mic', services: ['4'], ops: [{ op: 'append', line: '간증자 Mic' }], at: '' },
      { id: 'b', row: 'header', col: 'videos', services: ['4'], ops: [{ op: 'set', lines: ['영상 A'] }], at: '' },
    ];
    const s = buildSheet(rules, doc, '4');
    expect(s.header.mics).toContain('간증자 Mic');
    expect(s.header.videos).toEqual(['영상 A']);
  });

  it('migration hoists fields every service shares', () => {
    const w = emptyWeek('2026-10-18');
    for (const sid of ['1', '2', '4']) { w.services[sid].people['설교'] = '같은 목사'; w.services[sid].people['인도'] = `인도${sid}`; }
    w.services['1'].people['사회'] = w.services['4'].people['사회'] = '같은 사회';
    const doc = weekToDoc(rules, w);
    // 2부 사회 is not taken from the others (the guideline leaves it empty when there is none)
    expect([doc.shared.people, doc.origin.people]).toEqual([{ 설교: '같은 목사', 사회: '같은 사회' }, { 설교: '1', 사회: '1' }]);
    expect(doc.services['2'].people).toEqual({ 인도: '인도2' });
    hoistShared(rules, doc);
    expect(doc.shared.people['인도']).toBeUndefined();
  });

  it('text import of one service keeps the others and only changes what the text has', () => {
    const doc = emptyDoc(rules, 'sunday', '2026-10-18');
    doc.services['1'].people['사회'] = '일부 사회';
    doc.services['4'].people['PD'] = '사부 PD';
    doc.edits = [{ id: 'k', row: 'sermon', col: 'details', services: ['1', '4'], ops: [{ op: 'append', line: '-x' }], at: '' }];
    const w = emptyWeek('2026-10-18');
    for (const sid of ['1', '2']) w.services[sid].include = false;
    w.services['4'].people['사회'] = '사부 사회';
    const out = importWeek(rules, doc, w);
    expect(out.services['1'].people['사회']).toBe('일부 사회');
    expect(out.services['4'].people).toEqual({ PD: '사부 PD', 사회: '사부 사회' });
    expect(out.edits.map((e) => e.services)).toEqual([['1', '4']]);
  });
});

// ---------------- event tables (가이드라인 표 4, 13-17) ----------------

type RawCell = { paras: string[]; span: number; vm: string | null; bold: number[]; fill: string | null };
const tables = new Map<number, RawCell[][]>((raw as any[]).filter((x) => x.k === 'tbl').map((x) => [x.i as number, x.rows as RawCell[][]]));
const lines = (c: RawCell) => {
  const ls = c.paras.map((p) => p.trim());
  while (ls.length && !ls[0]) ls.shift();
  while (ls.length && !ls[ls.length - 1]) ls.pop();
  return ls;
};
const norm = (ls: string[]) => ls.map((s) => s.replace(/['”]/g, '’').replace(/\s+/g, ' '));
const outN = (ls: OutLine[] | string[]) => norm(ls.map((l) => (typeof l === 'string' ? l : l.text)));

describe('guideline fidelity: event tables', () => {
  for (const kind of ['wed', 'newyear', 'baptism', 'christmas', 'yearend', 'bridge'] as Kind[]) {
    it(kind, () => {
      const svc = rules.services[kind];
      const t = tables.get(svc.guidelineTable)!;
      const s = buildSheet(rules, emptyDoc(rules, kind, '2026-12-24'), kind);
      expect(s.cols).toEqual(svc.cols);
      expect(t[0].length).toBe(svc.cols.length + 1);
      const rc = s.rehearsal.cells;
      expect(outN(s.rehearsal.time)).toEqual(norm(lines(t[1][0])));
      svc.cols.forEach((c, j) => expect([c, outN(rc[c === 'light' ? 'lightA' : c] ?? [])]).toEqual([c, norm(lines(t[1][j + 1]))]));
      expect(outN(rc.lightB)).toEqual(norm(lines(t[2][svc.cols.indexOf('light') + 1])));
      const body = t.slice(3);
      expect(s.rows.length).toBe(body.length);
      body.forEach((r, i) => {
        const cell = (j: number) => {
          let k = i;
          while (k > 0 && body[k][j].vm === 'continue') k--;
          return norm(lines(body[k][j]));
        };
        const row = s.rows[i];
        expect([row.key, outN(row.time)]).toEqual([row.key, cell(0)]);
        svc.cols.forEach((c, j) => expect([row.key, c, outN(row.cells[c])]).toEqual([row.key, c, cell(j + 1)]));
      });
      expect(s.warnings.filter((w) => w.level === 'warn' && !w.text.startsWith('출연'))).toEqual([]);
    });
  }
});
