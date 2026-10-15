import { describe, expect, it } from 'vitest';
import rulesJson from '../src/rules/rules.json';
import { buildSheet, isKnownRowName } from '../src/core/engine';
import { emptyDoc, fieldMode, fieldValue, isDate, normalizeDoc } from '../src/core/doc';
import { saveCell } from '../src/core/cellsave';
import {
  addCustom, addSpecial, copyDoc, copyPeople, COPY_DEFAULT, differingServices, makeOwn, makeShared, removeRow, renameCustom,
  reorder, restoreRow, setDur, writeField,
} from '../src/core/ops';
import { importWeek } from '../src/core/migrate';
import { parseCtx, parseText, SUNDAY_CTX, toText } from '../src/core/parse';
import type { CueDoc, RulesFile } from '../src/core/types';

const rules = rulesJson as unknown as RulesFile;
const keys = (doc: CueDoc, sid: string) => buildSheet(rules, doc, sid).rows.map((r) => r.key);
const isName = (sid: string, n: string) => isKnownRowName(rules, sid, n);
const sunday = (date = '2026-10-18') => emptyDoc(rules, 'sunday', date); // 셋째 주일: no automatic specials

describe('order list', () => {
  it('reorders with the fewest moves and keeps the guideline order otherwise', () => {
    const doc = sunday();
    const k = keys(doc, '1');
    const next = k.filter((x) => x !== 'announce');
    next.splice(next.indexOf('sermon') + 1, 0, 'announce');
    reorder(rules, doc, '1', next);
    expect(keys(doc, '1')).toEqual(next);
    expect(doc.services['1'].moves).toHaveLength(1);
    reorder(rules, doc, '1', k);
    expect(doc.services['1'].moves).toEqual([]);
  });

  it('✕ takes a guideline row out, a special row switches the special off, 되살리기 puts it back', () => {
    const doc = sunday('2026-10-04'); // 첫째 주일: 성찬식
    expect(keys(doc, '1')).toContain('communion');
    removeRow(rules, doc, '1', 'communion');
    expect(doc.services['1'].specials).toEqual({ 성찬식: false });
    expect(keys(doc, '1')).not.toContain('communion');
    addSpecial(rules, doc, ['1'], '성찬식');
    expect(doc.services['1'].specials).toEqual({}); // back to the guideline
    removeRow(rules, doc, '1', 'reading');
    expect(doc.services['1'].off).toEqual(['reading']);
    expect(buildSheet(rules, doc, '1').removed.map((r) => r.key)).toEqual(['reading']);
    restoreRow(doc, '1', 'reading');
    expect(keys(doc, '1')).toContain('reading');
  });

  it('+ 특별순서 from the guideline goes to its place in every picked service', () => {
    const doc = sunday();
    addSpecial(rules, doc, ['1', '2', '4'], '파송식');
    for (const [sid, anchor] of [['1', 'bible'], ['2', 'fellowship'], ['4', 'fellowship']]) {
      const k = keys(doc, sid);
      expect(k[k.indexOf(anchor) + 1]).toBe('mission');
      expect(doc.services[sid].specials['파송식']).toBe(true);
    }
    addSpecial(rules, doc, ['1'], '성가대');
    expect(keys(doc, '1')).toContain('choir');
    expect(doc.services['2'].specials['성가대']).toBeUndefined(); // 2부 has no 성가대
  });

  it('+ 특별순서 typed by the user: one key in every service, after the chosen row or at the end', () => {
    const doc = sunday();
    const key = addCustom(rules, doc, ['1', '2', '4'], '환영 인사', 5, 'sermon');
    for (const sid of ['1', '2', '4']) {
      const k = keys(doc, sid);
      expect(k[k.indexOf('sermon') + 1]).toBe(key);
      const row = buildSheet(rules, doc, sid).rows.find((r) => r.key === key)!;
      expect(row).toMatchObject({ custom: true, dur: 5, name: '환영 인사' });
    }
    const first = addCustom(rules, doc, ['4'], '처음', 2, null);
    expect(keys(doc, '4')[0]).toBe(first);
    const end = addCustom(rules, doc, ['1', '4'], '끝', 3, 'offerprayer'); // 4부 has no 봉헌 기도
    expect(keys(doc, '4').at(-1)).toBe(end);
    expect(keys(doc, '1')[keys(doc, '1').indexOf('offerprayer') + 1]).toBe(end);

    renameCustom(doc, key, '새가족 환영');
    for (const sid of ['1', '2', '4']) expect(buildSheet(rules, doc, sid).rows.find((r) => r.key === key)!.name).toBe('새가족 환영');

    // dragging keeps the added row and its title
    const k1 = keys(doc, '1');
    const moved = [key, ...k1.filter((x) => x !== key)];
    reorder(rules, doc, '1', moved);
    expect(keys(doc, '1')).toEqual(moved);
    expect(buildSheet(rules, doc, '1').rows[0].name).toBe('새가족 환영');

    doc.edits = [{ id: 'e', row: key, col: 'role', services: ['1', '2'], ops: [{ op: 'set', lines: ['사회자'] }], at: '' }];
    removeRow(rules, doc, '1', key);
    expect(keys(doc, '1')).not.toContain(key);
    expect(doc.services['1'].durs[key]).toBeUndefined();
    expect(keys(doc, '2')).toContain(key);
    expect(doc.edits.map((e) => e.services)).toEqual([['2']]);
  });

  it('minutes equal to the guideline clear the change', () => {
    const doc = sunday();
    setDur(doc, '1', 'sermon', 35, 30);
    expect(buildSheet(rules, doc, '1').rows.find((r) => r.key === 'sermon')!.dur).toBe(35);
    setDur(doc, '1', 'sermon', 30, 30);
    expect(doc.services['1'].durs).toEqual({});
  });
});

describe('fields', () => {
  it('공통 fields change every service, 이 예배만 only one', () => {
    const doc = sunday();
    writeField(doc, '1', 'people', '설교', '이목사');
    expect(fieldMode(doc, '1', 'people', '설교')).toBe('shared');
    for (const sid of ['1', '2', '4']) expect(fieldValue(doc, sid, 'people', '설교')).toBe('이목사');

    makeOwn(doc, '4', 'people', '설교');
    writeField(doc, '4', 'people', '설교', '김목사');
    expect(fieldValue(doc, '1', 'people', '설교')).toBe('이목사');
    expect(fieldValue(doc, '4', 'people', '설교')).toBe('김목사');
    expect(differingServices(doc, '1', 'people', '설교')).toEqual(['4']);

    // clearing keeps 이 예배만 (it does not fall back to the shared value)
    writeField(doc, '4', 'people', '설교', '');
    expect(fieldMode(doc, '4', 'people', '설교')).toBe('own');
    expect(fieldValue(doc, '4', 'people', '설교')).toBe('');

    writeField(doc, '4', 'people', '설교', '김목사');
    makeShared(doc, '4', 'people', '설교');
    for (const sid of ['1', '2', '4']) expect(fieldValue(doc, sid, 'people', '설교')).toBe('김목사');
    expect(differingServices(doc, '1', 'people', '설교')).toEqual([]);

    // staff start per service; an empty value is simply gone
    writeField(doc, '2', 'people', 'PD', '박PD');
    expect(fieldMode(doc, '2', 'people', 'PD')).toBe('own');
    expect(fieldValue(doc, '1', 'people', 'PD')).toBeUndefined();
    writeField(doc, '2', 'people', 'PD', '');
    expect('PD' in doc.services['2'].people).toBe(false);

    writeField(doc, '1', 'lists', '본문', ['요 3:16']);
    expect(fieldValue(doc, '4', 'lists', '본문')).toEqual(['요 3:16']);
  });

  it('copies staff from another service', () => {
    const doc = sunday();
    doc.services['2'].people = { PD: 'A', FD: 'B' };
    doc.services['4'].people = { PD: 'X', 음향: 'Y' };
    copyPeople(doc, '2', '4', ['PD', 'FD', '음향']);
    expect(doc.services['4'].people).toEqual({ PD: 'A', FD: 'B' });
  });
});

describe('new document from an earlier one', () => {
  it('copies people, order and cell changes by default, not specials or songs', () => {
    const prev = sunday('2026-10-11');
    prev.shared.people['설교'] = '이목사';
    prev.services['1'].people['PD'] = 'A';
    prev.services['1'].vocals = 3;
    prev.services['1'].lists['찬양'] = ['곡'];
    prev.services['1'].specials['파송식'] = true;
    prev.services['1'].off = ['reading'];
    const key = addCustom(rules, prev, ['1'], '환영', 4, 'sermon');
    prev.edits = [
      { id: 'a', row: 'sermon', col: 'details', services: ['1'], ops: [{ op: 'append', line: '-x' }], at: '' },
      { id: 'b', row: key, col: 'role', services: ['1'], ops: [{ op: 'set', lines: ['사회자'] }], at: '' },
    ];
    const doc = copyDoc(rules, prev, '2026-10-18', COPY_DEFAULT, 'now');
    expect(doc).toMatchObject({ id: 'sunday-2026-10-18', date: '2026-10-18', updatedAt: 'now' });
    expect(doc.shared.people).toEqual({ 설교: '이목사' });
    expect(doc.services['1']).toMatchObject({ people: { PD: 'A' }, vocals: 3, lists: {}, specials: {}, off: ['reading'] });
    expect(keys(doc, '1')).toContain(key);
    expect(doc.edits.map((e) => e.row)).toEqual(['sermon', key]);
    expect(doc.edits[0].id).not.toBe('a');

    const noOrder = copyDoc(rules, prev, '2026-10-18', { ...COPY_DEFAULT, order: false, content: true, specials: true });
    expect(noOrder.edits.map((e) => e.row)).toEqual(['sermon']);
    expect(noOrder.services['1']).toMatchObject({ lists: { 찬양: ['곡'] }, specials: { 파송식: true }, off: [], moves: [] });
  });
});

describe('text import', () => {
  it('reads every occasion: its sections, people and song lists', () => {
    const wed = parseText('설교: 김목사\n인도: 박전도사\n설교후찬양:\n1. 주 은혜\n2. 나의 예수', '2026-10-14', isName, parseCtx(rules, 'wed'));
    expect(Object.keys(wed.week.services)).toEqual(['wed']);
    expect(wed.week.services.wed).toMatchObject({ include: true, people: { 설교: '김목사', 인도: '박전도사' }, lists: { 설교후찬양: ['주 은혜', '나의 예수'] } });
    expect(wed.warnings).toEqual([]);
    expect(parseText('[수요성령집회]\n설교: A', '2026-10-14', isName, parseCtx(rules, 'wed')).week.services.wed.people).toEqual({ 설교: 'A' });
    expect(parseText('[1부]\n설교: A', '2026-10-14', isName, parseCtx(rules, 'wed')).warnings[0]).toMatch(/알 수 없는 구역/);

    const ye = parseText('봉독: 최집사\n특순: 청년부\n특순곡:\n- 은혜', '2026-12-31', isName, parseCtx(rules, 'yearend')).week.services.yearend;
    expect(ye.people).toEqual({ 봉독: '최집사', 특순: '청년부' });
    expect(ye.lists).toEqual({ 특순곡: ['은혜'] });

    const sun = parseText('[2부]\n봉독: 최집사\n특순: 중창단\n[P130]\n찬양:\n1. A\n-- 광고 --\n2. B', '2026-10-11', isName, parseCtx(rules, 'sunday'));
    expect(sun.week.services['2'].people).toEqual({ 나래이션: '최집사' });
    expect(sun.week.services['2'].values).toEqual({ 특순: '중창단' });
    expect(sun.week.services['4'].lists).toEqual({ 찬양1: ['A'], 찬양2: ['B'] });
    expect(sun.week.services['1'].include).toBe(false);
  });

  it('the occasion context for 주일 reads like the built-in one', () => {
    const ctx = parseCtx(rules, 'sunday');
    const t = '날짜: 2026-10-11\n설교: 이목사\n[1부]\n사회: A\n찬양:\n1. X\n[4부]\n찬양1:\n1. Y\n순서:\n찬양 1\n설교 30';
    expect(parseText(t, '2026-10-11', isName, ctx).week).toEqual(parseText(t, '2026-10-11', isName, SUNDAY_CTX).week);
    const yw = parseText('설교: A\n찬양:\n1. 곡', '2026-12-31', isName, parseCtx(rules, 'yearend')).week;
    expect(parseText(toText(yw, parseCtx(rules, 'yearend')), '2026-12-31', isName, parseCtx(rules, 'yearend')).week).toEqual(yw);
  });

  it('merges into the saved document: an order replaces, 시간 only changes minutes, rows keep their keys', () => {
    const ctx = parseCtx(rules, 'sunday');
    const doc = sunday();
    doc.shared.people['설교'] = '이목사';
    const key = addCustom(rules, doc, ['1', '2'], '환영', 4, 'sermon');
    doc.edits = [{ id: 'e', row: key, col: 'role', services: ['1', '2'], ops: [{ op: 'set', lines: ['사회자'] }], at: '' }];
    setDur(doc, '2', 'praise', 15, 12);

    const t1 = '[1부]\n순서:\n인트로 영상\n찬양\n설교 32\n환영 3\n봉헌 찬양\n축도\n[2부]\n시간:\n설교 33';
    const out = importWeek(rules, doc, parseText(t1, doc.date, isName, ctx).week, 'sunday', 'now');
    expect(keys(out, '1')).toEqual(['intro', 'praise', 'sermon', key, 'offering', 'benediction']);
    expect(out.services['1'].durs).toEqual({ sermon: 32, [key]: 3 });
    expect(out.services['2'].durs).toEqual({ praise: 15, [key]: 4, sermon: 33 });
    expect(keys(out, '2')).toContain(key);
    expect(out.edits.map((e) => e.services)).toEqual([['1', '2']]);
    expect(out.shared.people['설교']).toBe('이목사');

    // the same text twice adds nothing; a 공통 value equal for every service becomes shared
    const t2 = '[4부]\n추가:\n설교 | 세부사항 | -메모';
    const once = importWeek(rules, out, parseText(t2, doc.date, isName, ctx).week);
    expect(once.edits.length).toBe(out.edits.length + 1);
    expect(importWeek(rules, once, parseText(t2, doc.date, isName, ctx).week).edits.length).toBe(once.edits.length);
    const twice = importWeek(rules, once, parseText('설교: 김목사', doc.date, isName, ctx).week);
    expect(twice.shared.people['설교']).toBe('김목사');
    for (const sid of ['1', '2', '4']) expect('설교' in twice.services[sid].people).toBe(false);

    // only 4부 written: its own value, the others keep the shared one
    const t3 = '[4부]\n설교: 박목사';
    const one = importWeek(rules, twice, parseText(t3, doc.date, isName, ctx).week);
    expect(fieldValue(one, '1', 'people', '설교')).toBe('김목사');
    expect(fieldValue(one, '4', 'people', '설교')).toBe('박목사');
    const back = importWeek(rules, one, parseText('[4부]\n설교: 김목사', doc.date, isName, ctx).week);
    expect('설교' in back.services['4'].people).toBe(false);

    // another date is another document
    const other = importWeek(rules, doc, parseText('날짜: 2026-10-25\n설교: X', doc.date, isName, ctx).week);
    expect(other.id).toBe('sunday-2026-10-25');
    expect(other.edits).toEqual([]);
  });
});

describe('saved documents', () => {
  it('a saved document reads back exactly', () => {
    let doc = sunday('2026-10-04');
    writeField(doc, '1', 'lists', '찬양', ['곡 A', '곡 B']);
    writeField(doc, '4', 'people', '사회', '김 목사');
    setDur(doc, '2', 'announce', 7, 5);
    addSpecial(rules, doc, ['1', '2', '4'], '특별영상');
    const key = addCustom(rules, doc, ['1', '4'], '환영 인사', 3, 'praise');
    removeRow(rules, doc, '2', 'fellowship');
    doc.services['4'].vocals = 6;
    doc.services['1'].start = '07:45';
    doc = saveCell(rules, doc, { sid: '1', row: key, col: 'role', text: '사회자', scope: ['4'] }).doc;
    doc = saveCell(rules, doc, { sid: '2', row: 'sermon', col: 'details', text: '-설교자 등단\n-추가 줄' }).doc;
    expect(doc.edits.length).toBeGreaterThan(0);
    const back = normalizeDoc(rules, JSON.parse(JSON.stringify(doc)));
    expect(back).toEqual(doc);
    for (const sid of ['1', '2', '4']) expect(buildSheet(rules, back!, sid)).toEqual(buildSheet(rules, doc, sid));
  });

  it('refuses what is not a cue sheet document and drops malformed parts', () => {
    expect(normalizeDoc(rules, null)).toBeNull();
    expect(normalizeDoc(rules, { version: 1, date: '2026-10-18', services: {} })).toBeNull();
    expect(normalizeDoc(rules, { v: 2, kind: 'easter', date: '2026-10-18' })).toBeNull();
    expect(normalizeDoc(rules, { v: 2, kind: 'sunday', date: '2026-02-30' })).toBeNull();
    expect(isDate('2026-02-28')).toBe(true);
    const doc = normalizeDoc(rules, {
      v: 2, kind: 'wed', date: '2026-10-21', id: 'whatever', updatedAt: 'not a date',
      shared: { people: { 인도: '이 전도사', bad: 3 }, lists: { 찬양: ['곡', 4] } },
      services: {
        wed: { start: '7pm', vocals: -1, leaders: 2, specials: { x: 'yes' }, moves: [{ key: 'bible', after: 'praise' }, { key: 'bible', after: null }, { after: 'x' }], off: ['prayer2', 'prayer2', 3], durs: { sermon: 40, praise: -5 } },
        '1': { people: { 사회: '다른 예배' } },
      },
      edits: [
        { id: 'e1', row: 'sermon', col: 'details', services: ['wed', '1'], ops: [{ op: 'append', line: '-줄' }, { op: 'weird' }], at: '2026-10-20T00:00:00Z' },
        { id: 'e2', row: 'sermon', col: 'nope', services: ['wed'], ops: [{ op: 'append', line: 'x' }] },
        { id: 'e3', row: 'sermon', col: 'details', services: ['1'], ops: [{ op: 'append', line: 'x' }] },
        { id: 'e1', row: 'praise', col: 'mic', services: ['wed'], ops: [{ op: 'sub', from: '', to: 'x' }, { op: 'set', lines: ['A'] }] },
      ],
    })!;
    expect(doc.id).toBe('wed-2026-10-21');
    expect(Object.keys(doc.services)).toEqual(['wed']);
    expect(doc.shared).toEqual({ people: { 인도: '이 전도사' }, values: {}, lists: { 찬양: ['곡'] } });
    expect(doc.services.wed).toEqual({
      people: {}, values: {}, lists: {}, leaders: 2, specials: {}, moves: [{ key: 'bible', after: 'praise' }], off: ['prayer2'], durs: { sermon: 40 },
    });
    expect(doc.edits.map((e) => [e.id === 'e1', e.row, e.col, e.services, e.ops])).toEqual([
      [true, 'sermon', 'details', ['wed'], [{ op: 'append', line: '-줄' }]],
      [false, 'praise', 'mic', ['wed'], [{ op: 'set', lines: ['A'] }]],
    ]);
    expect(buildSheet(rules, doc, 'wed').rows.length).toBeGreaterThan(3);
  });
});
