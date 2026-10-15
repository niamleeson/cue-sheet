import { describe, expect, it } from 'vitest';
import rulesJson from '../src/rules/rules.json';
import { emptyService, emptyWeek, guidelineRows } from '../src/core/engine';
import { emptyDoc } from '../src/core/doc';
import { v1WeekDoc } from '../src/core/migrate';
import type { RulesFile, ServiceInput } from '../src/core/types';

const rules = rulesJson as unknown as RulesFile;
const AT = '2026-10-14T00:00:00.000Z';
const DATE = '2026-10-18';
const week = (one: Partial<ServiceInput> = {}) => {
  const w = emptyWeek(DATE);
  for (const sid of ['1', '2', '4']) w.services[sid] = emptyService();
  Object.assign(w.services['1'], one);
  return w;
};

describe('the first version’s saved week', () => {
  it('a week where nothing was typed makes no document (a service left out is not something typed)', () => {
    expect(v1WeekDoc(rules, week(), AT)).toBeNull();
    const w = week();
    w.services['2'].include = false;
    expect(v1WeekDoc(rules, w, AT)).toBeNull();
  });

  it('any one thing typed is kept', () => {
    const row = guidelineRows(rules, emptyDoc(rules, 'sunday', DATE), '1')[1].key;
    const special = rules.services['1'].specials[0].id;
    const cases: Partial<ServiceInput>[] = [
      { start: '07:45' },
      { vocals: 2 },
      { leaders: 2 },
      { specials: { [special]: true } },
      { durations: { [row]: 9 } },
      { headerVideos: ['광고 영상'] },
      { people: { 사회자: '김사회' } },
      { values: { 봉헌위원: '홍길동' } },
      { lists: { 찬양: ['주의 이름 높이'] } },
    ];
    for (const c of cases) {
      const d = v1WeekDoc(rules, week(c), AT);
      expect(d, JSON.stringify(c)).not.toBeNull();
      expect(d!.id).toBe(`sunday-${DATE}`);
    }
  });
});
