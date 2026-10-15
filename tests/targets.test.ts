import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import rulesJson from '../src/rules/rules.json';
import { writeDocx } from '../src/core/docx';
import type { XmlImpl } from '../src/core/docx';
import { buildDoc } from '../src/core/engine';
import { emptyDoc } from '../src/core/doc';
import { cellLines } from '../src/core/cellsave';
import { renderPage } from '../src/core/render';
import { cellTargets } from '../src/core/targets';
import type { Kind, RulesFile, Sheet } from '../src/core/types';

const rules = rulesJson as unknown as RulesFile;
const xml = { DOMParser, XMLSerializer } as unknown as XmlImpl;
const squash = (s: string) => s.replace(/\s+/g, '');

async function page(sheet: Sheet) {
  const res = await writeDocx(readFileSync(join(__dirname, '..', 'src', 'templates', sheet.template)), sheet, xml);
  return renderPage(res.page, { rowKeys: sheet.rows.map((r) => r.key) }, new DOMParser() as unknown as globalThis.DOMParser);
}

const sheets = (['sunday', 'wed', 'baptism'] as Kind[]).flatMap((k) => {
  const doc = emptyDoc(rules, k, '2026-10-18');
  if (k === 'sunday') doc.shared.people['설교'] = '홍길동 목사';
  return buildDoc(rules, doc);
});

describe.each(sheets.map((s) => [s.label, s] as const))('%s: cells to click', (_l, sheet) => {
  it('every cell of the sheet has one target, over the text it shows', async () => {
    const p = await page(sheet);
    const ts = cellTargets(p, sheet);
    const key = (t: { row: string; col: string }) => `${t.row}/${t.col}`;
    const want = [
      'header/staff', 'header/cast', 'header/mics',
      'rehearsal/time', ...sheet.cols.map((c) => `rehearsal/${c === 'light' ? 'lightA' : c}`), 'rehearsal/lightB',
      ...sheet.rows.flatMap((r) => ['time', ...sheet.cols].map((c) => `${r.key}/${c}`)),
    ];
    const got = ts.map(key);
    for (const k of want) expect(got, k).toContain(k);
    expect(new Set(got).size).toBe(got.length);
    // each target sits on the page and holds its cell's text
    for (const t of ts) {
      expect(t.w).toBeGreaterThan(5);
      expect(t.h).toBeGreaterThan(5);
      expect(t.y + t.h).toBeLessThanOrEqual(p.viewHeight + 0.01);
      const lines = cellLines(sheet, t.row, t.col)!;
      expect(lines, key(t)).not.toBeNull();
      const inside = p.cells.filter((c) => c.x >= t.x - 0.01 && c.x < t.x + t.w && c.y < t.y + t.h && c.y + c.h > t.y + 0.01);
      const text = squash(inside.flatMap((c) => c.paras.filter((q) => q.y >= t.y - 0.01 && q.y < t.y + t.h).map((q) => q.text)).join(''));
      for (const l of lines) if (squash(l.text)) expect(text, key(t)).toContain(squash(l.text));
    }
    // order rows line up with the row hit areas
    for (const r of p.rows) {
      const t = ts.find((x) => x.row === r.key && x.col === 'content')!;
      expect(t.y).toBeCloseTo(r.y, 3);
    }
  });
});
