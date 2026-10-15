import { describe, expect, it } from 'vitest';
import rulesJson from '../src/rules/rules.json';
import { buildDoc, buildSheet, isKnownRowName } from '../src/core/engine';
import { weekToDoc } from '../src/core/migrate';
import { parseText } from '../src/core/parse';
import { SAMPLE_TEXT } from '../src/core/sample';
import type { RulesFile } from '../src/core/types';

const rules = rulesJson as unknown as RulesFile;
const { week } = parseText(SAMPLE_TEXT, '2026-10-11', (sid, n) => isKnownRowName(rules, sid, n));
const doc = weekToDoc(rules, week);
const text = (ls: { text: string }[]) => ls.map((l) => l.text);

describe('2026-10-11 4부 (P130) — matches the reviewed sheet', () => {
  const sheet = buildSheet(rules, doc, '4');

  it('order and times', () => {
    expect(sheet.rows.map((r) => [r.cells.content[0].text, r.time.join(' ')])).toEqual([
      ['▶찬양 1', '13:30 (13’)'],
      ['▶특별영상', '13:43 (3’)'],
      ['▶성도의 교제/교회소식', '13:46 (3’)'],
      ['▶찬양 2', '13:49 (17’)'],
      ['▶성경 봉독', '14:06 (2’)'],
      ['▶강사소개', '14:08 (2’)'],
      ['▶설교', '14:10 (25’)'],
      ['▶비전헌금 영상', '14:35 (2’)'],
      ['▶비전헌금/마무리 찬양', '14:37 (13’)'],
      ['▶마무리 기도', '14:50 (1’) *14:51'],
    ]);
    expect(sheet.end).toBe('14:51');
  });

  it('content lines', () => {
    const c = (k: string) => text(sheet.rows.find((r) => r.key === k)!.cells.content);
    expect(c('praise1')).toEqual(['▶찬양 1', '1. 내 모든 삶의 행동 G', '2. 주의 이름 높이며 G', '3. 모든 백성 만물아 Ab']);
    expect(c('specialvideo')).toEqual(['▶특별영상', '- 더브릿지 보고영상']);
    expect(c('praise2')[4]).toBe('4. 예수 하나님의 공의 Db');
    expect(c('bible')).toEqual(['▶성경 봉독', '- 이사야 (Isaiah) 43:19-21']);
    expect(c('sermon')).toEqual(['▶설교', '- 선교의 여정 속에서 발견한 세 가지']);
    expect(c('closing')).toEqual(['▶비전헌금/마무리 찬양', '- 그 사랑(아버지 사랑 내가 노래해) F']);
  });

  it('the review fixes: 강대상 at the end of 찬양 2, 설교자 등단 only at 강사소개', () => {
    const d = (k: string) => text(sheet.rows.find((r) => r.key === k)!.cells.details);
    expect(d('praise2')).toContain('-찬양말미 강대상 등단');
    expect(d('speaker')).toEqual(['-설교자 등단']);
    expect(d('bible').some((l) => l.includes('설교자 등단'))).toBe(false);
    expect(text(sheet.rows.find((r) => r.key === 'praise1')!.cells.details)).toContain('-타이머 36분 세팅');
  });

  it('header', () => {
    expect(sheet.header.staff).toEqual(['-PD: 김재현', '-FD: N/A', '-음향: 현준호(본당)', '-조명: 전평구', '-자막: 최정민(본당)', '-방송실: 조민희', '-카메라: 조민희']);
    expect(sheet.header.cast).toEqual(['■사회: 심형진 목사', '■설교: 노형수 목사', '■인도: 심형진 목사']);
    expect(sheet.header.mics).toEqual(['설교자 Mic', '사회자 Mic', '인도자 Mic #1', '보컬 Mic #1-4', 'Full Band', 'BGM']);
    expect(sheet.header.videos).toEqual(['더브릿지 보고영상', '비전헌금 영상']);
    expect(sheet.dateText).toBe('2026년 10월 11일');
    expect(sheet.fileBase).toBe('2026 1011 주일4부예배P130 큐시트');
  });

  it('flags only what needs a human look', () => {
    expect(sheet.warnings.filter((w) => w.level === 'warn').map((w) => w.text)).toMatchSnapshot();
  });
});

describe('2026-10-11 all services from one input', () => {
  const sheets = buildDoc(rules, doc);
  it('builds 1부, 2부 and 4부 with their own data', () => {
    expect(sheets.map((s) => s.label)).toEqual(['1부', '2부', '4부 (P130)']);
    expect(sheets.map((s) => s.fileBase)).toEqual(['2026 1011 주일1부예배 큐시트', '2026 1011 주일2부예배 큐시트', '2026 1011 주일4부예배P130 큐시트']);
    const [s1, s2] = sheets;
    expect(s1.rows.map((r) => r.key)).toContain('choir');
    expect(s2.rows.map((r) => r.key)).not.toContain('choir');
    // second Sunday: 비전헌금 is automatic everywhere
    for (const s of sheets) expect(s.rows.map((r) => r.key)).toContain('visionvideo');
    expect(s1.header.cast[2]).toBe('■설교: OOO 목사');
    expect(s2.header.cast.some((c) => c.startsWith('■나래이션'))).toBe(true);
  });
});
