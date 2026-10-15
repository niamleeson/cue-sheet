import { describe, expect, it } from 'vitest';
import rulesJson from '../src/rules/rules.json';
import { buildDoc, buildSheet, fmtMin, guidelineRows, toMin } from '../src/core/engine';
import { computeMoves, emptyDoc, fieldValue } from '../src/core/doc';
import { writeField } from '../src/core/ops';
import {
  autoformat, cellLines, cellText, diffOps, linkedEdits, removeEdit, resetCell, saveCell, scopeChoices, similarity, tidy, unformat,
} from '../src/core/cellsave';
import type { CueDoc, EditCol, RulesFile, Sheet } from '../src/core/types';

const rules = rulesJson as unknown as RulesFile;
const AT = '2026-10-14T00:00:00.000Z';
const sunday = () => emptyDoc(rules, 'sunday', '2026-10-18');
const sheet = (doc: CueDoc, sid: string) => buildSheet(rules, doc, sid);
const cell = (doc: CueDoc, sid: string, row: string, col: EditCol) => cellText(cellLines(sheet(doc, sid), row, col));
const save = (doc: CueDoc, sid: string, row: string, col: EditCol, text: string, scope?: string[]) =>
  saveCell(rules, doc, { sid, row, col, text, ...(scope ? { scope } : {}) }, AT);
/** saving what the cell shows changes nothing */
const roundTrip = (doc: CueDoc, sid: string, row: string, col: EditCol) => {
  const r = save(doc, sid, row, col, cell(doc, sid, row, col));
  expect([r.changes, r.edits, r.doc.edits]).toEqual([[], [], doc.edits]);
};

describe('autoformat', () => {
  it('tidies spaces and empty lines; puts new lines in the column style', () => {
    expect(tidy('details', '  a   b \n\n - c\t')).toEqual(['a b', '- c']);
    expect(['a b', '- c', '(참고)', '※ 주의'].map((l, i) => autoformat('details', l, i))).toEqual(['-a b', '-c', '(참고)', '※ 주의']);
    expect(['▶ 찬양', '1.곡', '2 ) 곡', '-x', 'x'].map((l, i) => autoformat('content', l, i))).toEqual(['▶찬양', '1. 곡', '2) 곡', '- x', '- x']);
    expect(autoformat('content', '제목', 0)).toBe('제목');
    expect(autoformat('mic', '보컬 mic #1 - 4', 0)).toBe('보컬 Mic #1-4');
    expect(autoformat('lightA', '무대 65 %', 0)).toBe('무대 65%');
  });
  it('time and header cells are put in their style right away', () => {
    expect(tidy('time', '7:30\n12\n(5\')\n*8:41')).toEqual(['07:30', '(12’)', '(5’)', '*08:41']);
    expect(tidy('staff', 'PD : 김피디\n- FD:박')).toEqual(['-PD: 김피디', '-FD: 박']);
    expect(tidy('cast', '사회:이\n■ 설교 : 홍')).toEqual(['■사회: 이', '■설교: 홍']);
  });
  it('unformat and similarity', () => {
    expect(unformat('2. 주의 사랑', '{n}. {item}')).toBe('주의 사랑');
    expect(unformat('- 요 3:16', '- {item}')).toBe('요 3:16');
    expect(unformat('3) 곡', '{item}')).toBe('곡');
    expect(unformat('- ', '- {item}')).toBeNull();
    expect(similarity('-설교 OUTLINE 적용', '-설교 OUTLINE 적용!')).toBeGreaterThan(0.8);
    expect(similarity('abc', 'xyz')).toBe(0);
  });
  it('diffOps keeps anchors as text and marks new lines', () => {
    const old = [{ text: '-a' }, { text: '-b' }, { text: '-c' }];
    expect(diffOps(old, ['-a', 'x', '-c'], (l) => autoformat('details', l, 1))).toEqual([{ op: 'replace', line: '-b', with: '-x' }]);
    expect(diffOps(old, ['-a', '-b', '-c', 'd'], (l) => autoformat('details', l, 1))).toEqual([{ op: 'insert', after: '-c', line: '-d' }]);
    expect(diffOps(old, ['-a', '-c'])).toEqual([{ op: 'remove', line: '-b' }]);
    expect(diffOps(old, ['x'])).toEqual([{ op: 'set', lines: ['x'] }]);
    expect(diffOps([], ['x'])).toEqual([{ op: 'set', lines: ['x'] }]);
    expect(diffOps(old, ['- a', '-b', '-  c'], (l) => autoformat('details', l, 1))).toEqual([]);
  });
});

describe('saveCell: typed data goes back to the fields', () => {
  it('설교제목 typed in 1부 for every service is the shared value, as if typed in 1부\'s form', () => {
    const r = save(sunday(), '1', 'sermon', 'content', '▶ 설교\n- 은혜의 강물', ['2', '4']);
    expect([r.doc.shared.lists, r.doc.origin.lists]).toEqual([{ 설교제목: ['은혜의 강물'] }, { 설교제목: '1' }]);
    expect(r.edits).toEqual([]);
    expect(r.doc.edits).toEqual([]);
    expect(r.changes).toEqual(['설교제목: 은혜의 강물 — 1부, 2부, 4부 (P130)']);
    for (const sid of ['1', '2', '4']) expect(cell(r.doc, sid, 'sermon', 'content')).toBe('▶설교\n- 은혜의 강물');
    roundTrip(r.doc, '4', 'sermon', 'content');
    // only 1부 picked: the others keep showing nothing
    const one = save(sunday(), '1', 'sermon', 'content', '▶ 설교\n- 은혜의 강물');
    expect([one.doc.services['1'].lists, one.doc.shared.lists]).toEqual([{ 설교제목: ['은혜의 강물'] }, {}]);
    expect(one.changes).toEqual(['설교제목: 은혜의 강물 — 1부']);
    expect(cell(one.doc, '2', 'sermon', 'content')).toBe(cell(sunday(), '2', 'sermon', 'content'));
  });

  it('a shared value changed for some services: the services not picked keep what they showed', () => {
    const doc = sunday();
    writeField(rules, doc, '1', 'lists', '설교제목', ['은혜']);
    const r = save(doc, '1', 'sermon', 'content', '▶설교\n- 사랑', ['4']);
    expect([r.doc.shared.lists, r.doc.origin.lists]).toEqual([{ 설교제목: ['사랑'] }, { 설교제목: '1' }]);
    expect(r.doc.services['2'].lists).toEqual({ 설교제목: ['은혜'] });
    expect(r.changes).toEqual(['설교제목: 사랑 — 1부, 4부 (P130)']);
    // picked without the service it was typed in: their own value
    const two = save(doc, '2', 'sermon', 'content', '▶설교\n- 소망');
    expect([two.doc.services['2'].lists, two.doc.shared.lists]).toEqual([{ 설교제목: ['소망'] }, { 설교제목: ['은혜'] }]);
    // emptied for one service: the data cannot say so, the line is taken out as a cell change
    const off = save(doc, '4', 'sermon', 'content', '▶설교');
    expect(off.doc.shared.lists).toEqual({ 설교제목: ['은혜'] });
    expect(off.edits.map((e) => [e.row, e.col, e.services])).toEqual([['sermon', 'content', ['4']]]);
    expect([cell(off.doc, '4', 'sermon', 'content'), cell(off.doc, '2', 'sermon', 'content')]).toEqual(['▶설교', '▶설교\n- 은혜']);
  });

  it('찬양 stays in its service unless other services are picked', () => {
    const r = save(sunday(), '1', 'praise', 'content', '▶찬양\n1. 주의 사랑\n2.날 구원하신\n3. 은혜');
    expect(r.doc.services['1'].lists['찬양']).toEqual(['주의 사랑', '날 구원하신', '은혜']);
    expect(r.doc.services['2'].lists['찬양']).toBeUndefined();
    expect(r.doc.shared.lists).toEqual({});
    expect(r.doc.edits).toEqual([]);
    expect(cell(r.doc, '1', 'praise', 'content')).toBe('▶찬양\n1. 주의 사랑\n2. 날 구원하신\n3. 은혜');
    const both = save(sunday(), '1', 'praise', 'content', '▶찬양\n1. A\n2. B', ['2']);
    expect([both.doc.shared.lists, both.doc.origin.lists]).toEqual([{ 찬양: ['A', 'B'] }, { 찬양: '1' }]);
    expect(fieldValue(rules, both.doc, '2', 'lists', '찬양')).toEqual(['A', 'B']);
    expect(cell(both.doc, '2', 'praise', 'content')).toBe('▶찬양\nA\nB');
    expect(both.changes).toEqual(['찬양: A / B — 1부, 2부']);
  });

  it('list items: change, add, remove and reorder', () => {
    let doc = sunday();
    doc.services['1'].lists['찬양'] = ['A', 'B'];
    const items = () => doc.services['1'].lists['찬양'];
    doc = save(doc, '1', 'praise', 'content', '▶찬양\n1. A\n2. B2').doc;
    expect(items()).toEqual(['A', 'B2']);
    doc = save(doc, '1', 'praise', 'content', '▶찬양\n1. A\n2. B2\nC').doc;
    expect(items()).toEqual(['A', 'B2', 'C']);
    doc = save(doc, '1', 'praise', 'content', '▶찬양\n1. A\n3. C').doc;
    expect(items()).toEqual(['A', 'C']);
    doc = save(doc, '1', 'praise', 'content', '▶찬양\n1. C\n2. A').doc;
    expect(items()).toEqual(['C', 'A']);
    expect(doc.edits).toEqual([]);
    roundTrip(doc, '1', 'praise', 'content');
  });

  it('an emptied list keeps its data; the lines are taken out as a cell change', () => {
    const doc = sunday();
    doc.services['1'].lists['찬양'] = ['A', 'B'];
    const r = save(doc, '1', 'praise', 'content', '▶찬양');
    expect(r.doc.services['1'].lists['찬양']).toEqual(['A', 'B']);
    expect(r.edits.map((e) => e.ops)).toEqual([[{ op: 'remove', line: '1. A' }, { op: 'remove', line: '2. B' }]]);
    expect(cell(r.doc, '1', 'praise', 'content')).toBe('▶찬양');
  });

  it('a note line next to a list is not a list item', () => {
    const r = save(sunday(), '1', 'sermon', 'content', '▶설교\n(영상 후 설교)');
    expect(r.doc.shared.lists['설교제목']).toBeUndefined();
    expect(cell(r.doc, '1', 'sermon', 'content')).toBe('▶설교\n(영상 후 설교)');
    expect(r.edits.map((e) => e.services)).toEqual([['1']]);
  });

  it('fill-in values (봉헌위원) and spacing that only restyles a line', () => {
    const before = cell(sunday(), '1', 'offering', 'details');
    const typed = before.replace('-봉헌위원: 봉헌위원 1, 2', '- 봉헌위원 : 김철수, 이영희');
    const r = save(sunday(), '1', 'offering', 'details', typed);
    expect(r.doc.services['1'].values['봉헌위원']).toBe('김철수, 이영희');
    expect(r.doc.services['2'].values['봉헌위원']).toBeUndefined();
    expect(r.doc.edits).toEqual([]);
    expect(cell(r.doc, '1', 'offering', 'details')).toContain('-봉헌위원: 김철수, 이영희');
    roundTrip(r.doc, '1', 'offering', 'details');
  });

  it('singer count from the sound cell', () => {
    const r = save(sunday(), '1', 'praise', 'mic', '인도자 Mic\n보컬 Mic #1-5 Band');
    expect(r.doc.services['1'].vocals).toBe(5);
    expect(r.doc.edits).toEqual([]);
    expect(cell(r.doc, '1', 'praise', 'details')).toContain('-인도자 1, 보컬 5');
    const one = save(r.doc, '1', 'praise', 'mic', '인도자 Mic\n보컬 Mic #1 Band');
    expect(one.doc.services['1'].vocals).toBe(1);
    expect(cell(one.doc, '1', 'praise', 'mic')).toBe('인도자 Mic\n보컬 Mic #1 Band');
    const back = save(one.doc, '1', 'praise', 'details', cell(one.doc, '1', 'praise', 'details').replace('보컬 1', '보컬 3'));
    expect(back.doc.services['1'].vocals).toBeUndefined();
    expect(back.doc.edits).toEqual([]);
  });

  it('minutes typed in a template ({dur}) set the row length', () => {
    const doc = emptyDoc(rules, 'wed', '2026-10-14');
    const t = cell(doc, 'wed', 'praise', 'details');
    const n = Number(/찬양시간 (\d+)분/.exec(t)![1]);
    const r = save(doc, 'wed', 'praise', 'details', t.replace(`찬양시간 ${n}분`, `찬양시간 ${n + 5}분`));
    expect(r.doc.services.wed.durs.praise).toBe(n + 5);
    expect(r.doc.edits).toEqual([]);
  });

  it('time cell: minutes, start of a row (the row before gets longer), start of the service, end time', () => {
    const doc = sunday();
    const s = sheet(doc, '1');
    const [intro, praise] = s.rows;
    expect([intro.key, praise.key]).toEqual(['intro', 'praise']);
    let r = save(doc, '1', 'praise', 'time', `${praise.start}\n15`);
    expect(r.doc.services['1'].durs).toEqual({ praise: 15 });
    expect(r.doc.edits).toEqual([]);
    r = save(doc, '1', 'praise', 'time', '07:35\n(12’)');
    expect(r.doc.services['1'].durs).toEqual({ intro: 5 });
    expect(sheet(r.doc, '1').rows[1].start).toBe('07:35');
    r = save(doc, '1', 'intro', 'time', '7:00\n(1’)');
    expect(r.doc.services['1'].start).toBe('07:00');
    expect(r.doc.services['2'].start).toBeUndefined();
    const last = s.rows[s.rows.length - 1];
    r = save(doc, '1', last.key, 'time', `${last.start}\n(${last.dur}’)\n*${fmtMin(toMin(s.end) + 4)}`);
    expect(r.doc.services['1'].durs).toEqual({ [last.key]: last.dur + 4 });
    expect(r.doc.edits).toEqual([]);
  });

  it('header: names are typed like in the service\'s form', () => {
    const r = save(sunday(), '1', 'header', 'cast', '인도: 김인도\n■사회:박사회\n■설교: 홍목사');
    expect(r.doc.services['1'].people).toEqual({});
    expect(r.doc.shared.people).toEqual({ 인도: '김인도', 사회: '박사회', 설교: '홍목사' });
    expect(r.doc.origin.people).toEqual({ 인도: '1', 사회: '1', 설교: '1' });
    expect(r.doc.edits).toEqual([]);
    expect(r.changes).toEqual(['인도: 김인도 — 1부, 2부, 4부 (P130)', '사회: 박사회 — 1부, 4부 (P130)', '설교: 홍목사 — 1부, 2부, 4부 (P130)']);
    expect(sheet(r.doc, '4').header.cast).toEqual(['■사회: 박사회', '■설교: 홍목사', '■인도: 김인도']);
    expect(fieldValue(rules, r.doc, '2', 'people', '사회')).toBeUndefined();
    // typed where there is none yet: the shared value, the other services show it too
    const st = save(r.doc, '2', 'header', 'staff', cell(r.doc, '2', 'header', 'staff').replace('-PD:', '-PD: 김피디'));
    expect([st.doc.shared.people['PD'], st.doc.origin.people['PD']]).toEqual(['김피디', '2']);
    expect(sheet(st.doc, '1').header.staff).toContain('-PD: 김피디');
    // typed over another service's name: this service's own
    const own = save(r.doc, '4', 'header', 'cast', '■사회: 박사회\n■설교: 이목사\n■인도: 김인도');
    expect([own.doc.services['4'].people, own.doc.shared.people['설교']]).toEqual([{ 설교: '이목사' }, '홍목사']);
    // cleared where it was typed: gone everywhere
    const cleared = save(r.doc, '1', 'header', 'cast', '■인도:\n■사회: 박사회\n■설교: 홍목사');
    expect(cleared.doc.shared.people['인도']).toBeUndefined();
    expect(sheet(cleared.doc, '4').header.cast).toEqual(['■사회: 박사회', '■설교: 홍목사', '■인도:']);
  });
});

describe('saveCell: what the data cannot explain is kept as a cell change', () => {
  const details = (doc: CueDoc, sid: string) => cell(doc, sid, 'sermon', 'details');

  it('a new line in 세부사항, this service only or the picked ones', () => {
    const doc = sunday();
    const r = save(doc, '1', 'sermon', 'details', `${details(doc, '1')}\n설교 후 기도`);
    expect(r.edits).toHaveLength(1);
    expect(r.edits[0]).toMatchObject({ row: 'sermon', col: 'details', services: ['1'], at: AT });
    expect(r.edits[0].ops).toEqual([{ op: 'insert', after: '-마지막 슬라이드시 건반 대기', line: '-설교 후 기도' }]);
    expect(details(r.doc, '1').split('\n').at(-1)).toBe('-설교 후 기도');
    expect(details(r.doc, '2')).toBe(details(doc, '2'));
    const all = save(doc, '1', 'sermon', 'details', `${details(doc, '1')}\n설교 후 기도`, ['2', '4']);
    expect(all.edits.map((e) => e.services)).toEqual([['1', '2', '4']]);
    for (const sid of ['2', '4']) expect(details(all.doc, sid)).toContain('-설교 후 기도');
  });

  it('editing the cell again replaces its change where it applies; other services keep theirs', () => {
    const doc = sunday();
    const base = details(doc, '4');
    const a = save(doc, '1', 'sermon', 'details', `${base}\n-설교 후 기도`, ['2', '4']).doc;
    const b = save(a, '4', 'sermon', 'details', `${base}\n-다른 줄`).doc;
    expect(b.edits.map((e) => [e.services, e.ops])).toEqual([
      [['1', '2'], [{ op: 'insert', after: '-마지막 슬라이드시 건반 대기', line: '-설교 후 기도' }]],
      [['4'], [{ op: 'insert', after: '-마지막 슬라이드시 건반 대기', line: '-다른 줄' }]],
    ]);
    expect(details(b, '4')).toBe(`${base}\n-다른 줄`);
    expect(details(b, '1')).toBe(`${base}\n-설교 후 기도`);
    // back to what the guideline says: the change is gone
    const c = save(b, '4', 'sermon', 'details', base).doc;
    expect(c.edits.map((e) => e.services)).toEqual([['1', '2']]);
    expect(resetCell(b, '1', 'sermon', 'details').edits.map((e) => e.services)).toEqual([['2'], ['4']]);
    expect(removeEdit(b, b.edits[1].id).edits).toHaveLength(1);
  });

  it('changed ▶ title of a guideline row stays bold', () => {
    const r = save(sunday(), '2', 'sermon', 'content', '▶설교 말씀\n- 설교제목');
    expect(r.edits[0].ops).toEqual([{ op: 'replace', line: '▶설교', with: '▶설교 말씀' }]);
    expect(cellLines(sheet(r.doc, '2'), 'sermon', 'content')![0]).toEqual({ text: '▶설교 말씀', bold: true });
  });

  it('담당 변경 also changes the Mic and the names in 세부사항, with each service’s own Mic', () => {
    const doc = sunday();
    const role = cell(doc, '1', 'offering', 'role');
    expect(role.split('\n')[0]).toBe('사회자');
    const r = save(doc, '1', 'offering', 'role', role.replace('사회자', '설교자'));
    const e = r.edits[0];
    expect(e.note).toBe('담당 변경: 사회자 → 설교자');
    // 헌금's 세부사항 does not name the 사회자: only the Mic changes with it
    expect(e.also).toEqual([{ col: 'mic', ops: [{ op: 'sub', from: '사회자 Mic', to: '헤드셋 Mic' }] }]);
    const s = sheet(r.doc, '1');
    const row = s.rows.find((x) => x.key === 'offering')!;
    expect(row.cells.mic[0].text).toBe('헤드셋 Mic');
    expect(row.flags).toContain('담당 변경: 사회자 → 설교자');
    expect(s.editStatus[e.id]).toBe(true);

    const f = save(doc, '1', 'fellowship', 'role', cell(doc, '1', 'fellowship', 'role').replace('사회자', '설교자'));
    expect(f.edits[0].also).toEqual([
      { col: 'mic', ops: [{ op: 'sub', from: '사회자 Mic', to: '헤드셋 Mic' }] },
      { col: 'details', ops: [{ op: 'sub', from: '사회자', to: '설교자' }] },
    ]);
    expect(cell(f.doc, '1', 'fellowship', 'details')).toContain('설교자');
    expect(cell(f.doc, '1', 'fellowship', 'details')).not.toContain('사회자');
    expect(sheet(f.doc, '1').editStatus[f.edits[0].id]).toBe(true);
  });

  it('a linked cell (Mic of a 담당 변경) shows its edit and goes back on its own', () => {
    const doc = sunday();
    const f = save(doc, '1', 'fellowship', 'role', cell(doc, '1', 'fellowship', 'role').replace('사회자', '설교자'));
    expect(linkedEdits(f.doc, '1', 'fellowship', 'mic').map((e) => e.id)).toEqual([f.edits[0].id]);
    expect(linkedEdits(f.doc, '1', 'fellowship', 'role')).toEqual([]);
    const back = resetCell(f.doc, '1', 'fellowship', 'mic');
    expect(cell(back, '1', 'fellowship', 'mic').split('\n')[0]).toBe('사회자 Mic');
    expect(cell(back, '1', 'fellowship', 'role').split('\n')[0]).toBe('설교자');
    expect(cell(back, '1', 'fellowship', 'details')).toContain('설교자');
    expect(linkedEdits(back, '1', 'fellowship', 'mic')).toEqual([]);
    expect(back.edits).toHaveLength(1);
    expect(back.edits[0]).toMatchObject({ col: 'role', services: ['1'], note: '담당 변경: 사회자 → 설교자', also: [{ col: 'details' }] });
  });

  it('a linked change that no longer finds its line counts as not applied', () => {
    const doc = sunday();
    const f = save(doc, '1', 'fellowship', 'role', cell(doc, '1', 'fellowship', 'role').replace('사회자', '설교자'));
    const d = structuredClone(f.doc);
    d.edits[0].also![1].ops = [{ op: 'sub', from: '없는 이름', to: '설교자' }];
    expect(sheet(d, '1').editStatus[d.edits[0].id]).toBe(false);
  });

  it('rehearsal and header check cells', () => {
    const doc = sunday();
    const mic = cell(doc, '4', 'rehearsal', 'mic');
    const r = save(doc, '4', 'rehearsal', 'mic', `${mic}\n간증자 mic`);
    expect(r.edits[0].ops).toEqual([{ op: 'insert', after: mic.split('\n').at(-1), line: '간증자 Mic' }]);
    expect(sheet(r.doc, '4').header.mics).toContain('간증자 Mic');
    const light = save(doc, '4', 'rehearsal', 'lightB', `${cell(doc, '4', 'rehearsal', 'lightB')}\n무대 10 %`);
    expect(cell(light.doc, '4', 'rehearsal', 'lightB').split('\n').at(-1)).toBe('무대 10%');
  });

  it('a row the user added: its ▶ title renames it', () => {
    const doc = sunday();
    const sd = doc.services['4'];
    const base = guidelineRows(rules, doc, '4').map((x) => x.key);
    const final = [...base];
    final.splice(final.indexOf('sermon'), 0, 'custom:t');
    sd.moves = computeMoves(base, final, { 'custom:t': '간증' }, []);
    const r = save(doc, '4', 'custom:t', 'content', '▶ 간증 (김성도)\n- 3분');
    expect(r.doc.services['4'].moves.find((m) => m.key === 'custom:t')!.title).toBe('간증 (김성도)');
    expect(r.changes).toContain('순서 이름: 간증 (김성도)');
    expect(r.edits[0].ops).toEqual([{ op: 'insert', after: '▶간증 (김성도)', line: '- 3분' }]);
    expect(cell(r.doc, '4', 'custom:t', 'content')).toBe('▶간증 (김성도)\n- 3분');
  });
});

describe('scope choices', () => {
  it('other services with the cell, and whether it reads the same there', () => {
    const sheets: Sheet[] = buildDoc(rules, sunday());
    expect(scopeChoices(sheets, '1', 'sermon', 'details')).toEqual([
      { sid: '2', label: '2부', same: true }, { sid: '4', label: '4부 (P130)', same: true },
    ]);
    expect(scopeChoices(sheets, '1', 'praise', 'content')).toEqual([{ sid: '2', label: '2부', same: false }]);
    expect(scopeChoices(sheets, '1', 'praise', 'time')).toEqual([]);
    expect(scopeChoices(sheets, '1', 'header', 'cast')).toEqual([]);
  });
  it('a service without the cell is left out; times never go to other services', () => {
    const r = save(sunday(), '1', 'praise', 'details', '-x', ['4']);
    expect(r.edits.map((e) => e.services)).toEqual([['1']]);
    const t = save(sunday(), '1', 'sermon', 'time', '08:00\n(30’)', ['2']);
    expect(t.doc.services['2'].durs).toEqual({});
  });
});
