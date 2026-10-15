import { describe, expect, it } from 'vitest';
import rulesJson from '../src/rules/rules.json';
import { buildSheet, emptyService, isKnownRowName, rowNamesFor } from '../src/core/engine';
import { editLines, parseDate, parseEdits, parseSongs, parseText, toText } from '../src/core/parse';
import { SAMPLE_TEXT } from '../src/core/sample';
import type { RulesFile } from '../src/core/types';

const rules = rulesJson as unknown as RulesFile;
const isName = (sid: string, n: string) => isKnownRowName(rules, sid, n);
const parse = (t: string) => parseText(t, '2026-10-11', isName);

const WORSHIP_1004 = `10/4/26 4부 찬양

1. 여호와 Bb (갑기)
https://www.youtube.com/watch?v=WDVnDnNWlTE

2. 시편 139편 E (가현)
https://www.youtube.com/watch?v=mgS_ng-wAqY

-- 광고 --

3. 온 맘 다해 G (갑기)
https://www.youtube.com/watch?v=TNoGycM6MOo

4. 나의 가는 길 + 부르신 곳에서 E -> F (가현)
https://youtu.be/H7A39tM-crA?is=3-Hv1Y7z8HHXAejH

5. 나의 하나님 Bb (가현)
https://youtu.be/evFTNQOrL3w?is=Ah5KPjkWZDRnT_sU`;

describe('parseSongs / parseDate', () => {
  it('cleans a pasted worship-team message', () => {
    const r = parseSongs(WORSHIP_1004);
    expect(r.hasDivider).toBe(true);
    expect(r.before).toEqual(['여호와 Bb (갑기)', '시편 139편 E (가현)']);
    expect(r.after).toEqual(['온 맘 다해 G (갑기)', '나의 가는 길 + 부르신 곳에서 E → F (가현)', '나의 하나님 Bb (가현)']);
  });
  it('reads common date styles', () => {
    expect(parseDate('2026-10-4')).toBe('2026-10-04');
    expect(parseDate('2026년 10월 11일')).toBe('2026-10-11');
    expect(parseDate('10/4/26')).toBe('2026-10-04');
    expect(parseDate('10/11/2026')).toBe('2026-10-11');
    expect(parseDate('내일')).toBeNull();
  });
});

describe('parseText', () => {
  it('splits a pasted 4부 message into 찬양1 / 찬양2', () => {
    const { week, warnings } = parse(`날짜: 10/4/26\n[4부]\n찬양:\n${WORSHIP_1004}`);
    expect(week.date).toBe('2026-10-04');
    expect(week.services['4'].lists['찬양1']).toHaveLength(2);
    expect(week.services['4'].lists['찬양2']).toHaveLength(3);
    expect(week.services['1'].include).toBe(false);
    expect(week.services['2'].include).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('reads the sample: three services, each with its own people', () => {
    const { week, warnings } = parse(SAMPLE_TEXT);
    expect(warnings).toEqual([]);
    expect(Object.values(week.services).every((s) => s.include)).toBe(true);
    const s4 = week.services['4'];
    expect(s4.people).toMatchObject({ PD: '김재현', FD: 'N/A', 사회: '심형진 목사', 설교: '노형수 목사' });
    expect(s4.lists['찬양1']).toEqual(['내 모든 삶의 행동 G', '주의 이름 높이며 G', '모든 백성 만물아 Ab']);
    expect(s4.lists['찬양2']).toHaveLength(4);
    expect(s4.order?.map((o) => [o.ref, o.dur])).toEqual([
      ['찬양 1', 13], ['영상 - 더브릿지 보고영상', 3], ['성도의 교제/교회소식', 3], ['찬양 2', 17], ['성경 봉독', 2],
      ['강사소개', 2], ['설교', 25], ['영상 - 비전헌금', 2], ['마무리 찬양', 13], ['마무리 기도', 1],
    ]);
    expect(week.services['1'].specials['성가대']).toBe(true);
    expect(week.services['1'].lists['성가대찬양']).toEqual(['성가곡 제목']);
    expect(week.services['2'].people['나래이션']).toBe('OOO');
    expect(week.services['2'].lists['찬양']).toHaveLength(3);
  });

  it('applies [공통] to every listed service; sections override it', () => {
    const { week } = parse(`날짜: 2026-10-18\n[공통]\n본문: 요한복음 3:16\n설교: 공통 목사\n[1부]\n설교: 일부 목사\n[2부]\n인도: 이부 목사`);
    expect(week.services['1'].people['설교']).toBe('일부 목사');
    expect(week.services['2'].people['설교']).toBe('공통 목사');
    expect(week.services['2'].lists['본문']).toEqual(['요한복음 3:16']);
    expect(week.services['4'].include).toBe(false);
  });

  it('reads a row name that ends in a number', () => {
    const { week } = parse(`[4부]\n순서:\n찬양 1\n찬양 2\n설교 30분\n마무리 기도 (1’)`);
    expect(week.services['4'].order).toEqual([{ ref: '찬양 1' }, { ref: '찬양 2' }, { ref: '설교', dur: 30 }, { ref: '마무리 기도', dur: 1 }]);
    const one = parse(`[1부]\n순서:\n찬양 2`).week.services['1'];
    expect(one.order).toEqual([{ ref: '찬양', dur: 2 }]);
  });

  it('reads specials, durations, role changes and cell edits', () => {
    const { week, warnings } = parse(`[2부]
성찬식: 아니오
특별영상: 선교 보고
비전헌금: 자동
시간:
설교 35
담당변경:
성경 봉독: 봉독자 -> 사회자
추가:
설교 | 세부사항 | -마무리 기도시 밴드 등단 (상수)
변경:
축도 | 세부사항 | -첫째 줄
축도 | 세부사항 | -둘째 줄
아무말`);
    const s = week.services['2'];
    expect(s.specials).toEqual({ 성찬식: false, 특별영상: true });
    expect(s.values['영상이름']).toBe('선교 보고');
    expect(s.durations).toEqual({ 설교: 35 });
    expect(s.roles).toEqual([{ row: '성경 봉독', from: '봉독자', to: '사회자' }]);
    expect(s.edits).toEqual([
      { row: '설교', col: 'details', mode: 'append', lines: ['-마무리 기도시 밴드 등단 (상수)'] },
      { row: '축도', col: 'details', mode: 'replace', lines: ['-첫째 줄', '-둘째 줄'] },
    ]);
    expect(warnings.some((w) => w.includes('아무말'))).toBe(true);
  });

  it('round-trips through toText', () => {
    const a = parse(SAMPLE_TEXT).week;
    const b = parse(toText(a)).week;
    expect(b).toEqual(a);
  });
});

describe('engine uses parsed names', () => {
  it('applies durations, role changes and edits given by row name', () => {
    const { week } = parse(`날짜: 2026-10-18\n[2부]\n시간:\n설교 35\n추가:\n설교 | 세부사항 | -추가 줄`);
    const sheet = buildSheet(rules, '2', week);
    const sermon = sheet.rows.find((r) => r.key === 'sermon')!;
    expect(sermon.dur).toBe(35);
    expect(sermon.cells.details.at(-1)?.text).toBe('-추가 줄');
    expect(sheet.warnings.filter((w) => /없음 — 무시됨/.test(w.text))).toEqual([]);
  });
});

describe('app helpers', () => {
  it('rowNamesFor lists the base rows in guideline order, then rows specials can add', () => {
    for (const sid of ['1', '2', '4']) {
      const names = rowNamesFor(rules, sid);
      const base = rules.services[sid].rows.map((r) => r.name);
      expect(names.slice(0, base.length)).toEqual(base);
      expect(new Set(names).size).toBe(names.length);
      for (const n of names) expect(isKnownRowName(rules, sid, n)).toBe(true);
    }
    expect(rowNamesFor(rules, '4')).toContain('강사소개');
  });

  it('parseEdits reads the advanced editor and editLines writes it back', () => {
    const text = '담당변경:\n성경 봉독: 봉독자 -> 사회자\n추가:\n설교 | 세부사항 | -추가 줄\n변경:\n축도 | 세부사항 | -첫째 줄\n축도 | 세부사항 | -둘째 줄';
    const r = parseEdits('2', text, isName);
    expect(r.warnings).toEqual([]);
    expect(r.roles).toEqual([{ row: '성경 봉독', from: '봉독자', to: '사회자' }]);
    expect(r.edits).toEqual([
      { row: '설교', col: 'details', mode: 'append', lines: ['-추가 줄'] },
      { row: '축도', col: 'details', mode: 'replace', lines: ['-첫째 줄', '-둘째 줄'] },
    ]);
    expect(editLines({ ...emptyService(), roles: r.roles, edits: r.edits }).join('\n')).toBe(text);
  });

  it('parseEdits reports line numbers of the editor text', () => {
    const r = parseEdits('4', '추가:\n설교 세부사항 없음', isName);
    expect(r.edits).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/^2행/);
  });

  it('ignores blank order entries (a row being added in the app)', () => {
    const { week } = parse(`날짜: 2026-10-18\n[4부]\n순서:\n찬양 1\n설교`);
    week.services['4'].order!.splice(1, 0, { ref: '  ' });
    const sheet = buildSheet(rules, '4', week);
    expect(sheet.rows.map((r) => r.name)).toEqual(['찬양 1', '설교']);
    expect(sheet.rows.some((r) => r.key.startsWith('custom:'))).toBe(false);
    expect(toText(week)).not.toMatch(/순서:\n찬양 1\n\s*\n/);
  });

  it('role changes replace whole words only, with any characters in the name', () => {
    const week = parse(`날짜: 2026-10-18\n[4부]\n담당변경:\n성경 봉독: 사회자 -> 봉독자(1)`).week;
    const sheet = buildSheet(rules, '4', week);
    const row = sheet.rows.find((r) => r.name === '성경 봉독')!;
    expect(row.cells.role.map((l) => l.text)).toContain('봉독자(1)');
    const before = buildSheet(rules, '4', parse('날짜: 2026-10-18\n[4부]').week).rows.find((r) => r.name === '성경 봉독')!;
    const expected = before.cells.details.map((l) => l.text.split('사회자').join('봉독자(1)'));
    expect(row.cells.details.map((l) => l.text)).toEqual(expected);
  });
});
