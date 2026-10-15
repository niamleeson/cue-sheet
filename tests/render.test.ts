import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import rulesJson from '../src/rules/rules.json';
import { writeDocx } from '../src/core/docx';
import type { XmlImpl } from '../src/core/docx';
import { buildDoc, isKnownRowName } from '../src/core/engine';
import { weekToDoc } from '../src/core/migrate';
import { parseText } from '../src/core/parse';
import { renderPage } from '../src/core/render';
import { SAMPLE_TEXT } from '../src/core/sample';
import { COLS } from '../src/core/types';
import type { RulesFile, Sheet } from '../src/core/types';

const rules = rulesJson as unknown as RulesFile;
const xml = { DOMParser, XMLSerializer } as unknown as XmlImpl;
const { week } = parseText(SAMPLE_TEXT, '2026-10-11', (sid, n) => isKnownRowName(rules, sid, n));
const sheets = buildDoc(rules, weekToDoc(rules, week));
const tpl = (s: Sheet) => readFileSync(join(__dirname, '..', 'src', 'templates', s.template));
const OUT = process.env.CUESHEET_OUT; // set to write the pages as SVG for a visual check

const squash = (s: string) => s.replace(/\s+/g, '');
const texts = (svg: string) =>
  [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));

describe.each(sheets.map((s) => [s.label, s] as const))('%s page preview', (_l, sheet) => {
  it('draws the whole sheet, with the stage diagram, on one page', async () => {
    const res = await writeDocx(tpl(sheet), sheet, xml);
    const page = renderPage(res.page, { rowKeys: sheet.rows.map((r) => r.key) }, new DOMParser() as unknown as globalThis.DOMParser);
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, sheet.fileBase + '.svg'), page.svg);
    }
    expect(page.svg.startsWith('<svg')).toBe(true);
    expect(new DOMParser().parseFromString(page.svg, 'image/svg+xml').documentElement.localName).toBe('svg');
    expect(page.width).toBeCloseTo(595.3, 1);
    expect(page.bottom).toBeLessThanOrEqual(page.height);

    const all = squash(texts(page.svg).join(''));
    expect(all).toContain(squash(sheet.title));
    expect(all).toContain(squash(sheet.dateText));
    for (const t of ['무대', '회중석', '하수', '상수', '세부사항']) expect(all).toContain(t);
    for (const s of sheet.header.staff) expect(all).toContain(squash(s));

    // every service row is drawn in order, with a hit area for clicks and highlights
    expect(page.rows.map((r) => r.key)).toEqual(sheet.rows.map((r) => r.key));
    let from = 0;
    for (const row of sheet.rows) {
      const text = squash(row.time.join('') + COLS.map((c) => row.cells[c].map((l) => l.text).join('')).join(''));
      const at = all.indexOf(text, from);
      expect(at, `${row.name}: ${text}`).toBeGreaterThanOrEqual(0);
      from = at + text.length;
      expect(page.svg).toContain(`data-row="${row.key}"`);
    }
    for (let i = 1; i < page.rows.length; i++) expect(page.rows[i].y).toBeCloseTo(page.rows[i - 1].y + page.rows[i - 1].h, 3);
  });
});
