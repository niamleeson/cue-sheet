import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import rulesJson from '../src/rules/rules.json';
import { buildWeek, isKnownRowName } from '../src/core/engine';
import { parseText } from '../src/core/parse';
import { SAMPLE_TEXT } from '../src/core/sample';
import { W, writeDocx, TemplateError } from '../src/core/docx';
import type { XmlImpl } from '../src/core/docx';
import type { RulesFile, Sheet } from '../src/core/types';

const rules = rulesJson as unknown as RulesFile;
const xml = { DOMParser, XMLSerializer } as unknown as XmlImpl;
const { week } = parseText(SAMPLE_TEXT, '2026-10-11', (sid, n) => isKnownRowName(rules, sid, n));
const sheets = buildWeek(rules, week);
const tpl = (s: Sheet) => readFileSync(join(__dirname, '..', 'src', 'templates', s.template));
const OUT = process.env.CUESHEET_OUT; // set to write the generated files for a visual check in Word

async function docXml(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  return { zip, text: await zip.file('word/document.xml')!.async('string') };
}
/** Paragraph texts; a manual line break inside a short label counts as the space it replaced. */
const paraTexts = (s: string) => {
  const doc = new DOMParser().parseFromString(s, 'application/xml');
  const ps = doc.getElementsByTagNameNS(W, 'p');
  const out: string[] = [];
  for (let i = 0; i < ps.length; i++) {
    const p = ps.item(i) as Element;
    const ts = p.getElementsByTagNameNS(W, '*');
    let t = '';
    for (let j = 0; j < ts.length; j++) {
      const e = ts.item(j)!;
      if (e.localName === 't') t += e.textContent;
      else if (e.localName === 'br') t += ' ';
    }
    out.push(t);
  }
  return out;
};
/** Timeline rows (after the header and rehearsal rows) as [cell paragraphs][] */
const timelineRows = (s: string) => {
  const doc = new DOMParser().parseFromString(s, 'application/xml');
  const tbls = doc.getElementsByTagNameNS(W, 'tbl');
  const tbl = Array.from({ length: tbls.length }, (_, i) => tbls.item(i) as Element).find((t) => /세부사항/.test(t.textContent ?? ''))!;
  return Array.from({ length: tbl.childNodes.length }, (_, i) => tbl.childNodes.item(i))
    .filter((n): n is Element => n.nodeType === 1 && (n as Element).localName === 'tr')
    .map((tr) => Array.from({ length: tr.childNodes.length }, (_, i) => tr.childNodes.item(i)).filter((n): n is Element => n.nodeType === 1 && (n as Element).localName === 'tc'));
};

describe.each(sheets.map((s) => [s.label, s] as const))('%s docx', (_l, sheet) => {
  it('writes a well-formed document with every line of the sheet', async () => {
    const res = await writeDocx(tpl(sheet), sheet, xml);
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, sheet.fileBase + '.docx'), res.bytes);
      writeFileSync(join(OUT, sheet.fileBase + '.fit.json'), JSON.stringify({ fit: res.fit, warnings: res.warnings }));
    }
    const { zip, text } = await docXml(res.bytes);
    expect(text.startsWith('<?xml')).toBe(true);
    const ps = paraTexts(text);
    expect(ps).toContain(sheet.title);
    expect(ps.some((p) => p.trim() === sheet.dateText)).toBe(true);
    for (const r of sheet.rows) {
      for (const t of r.time) expect(ps).toContain(t);
      for (const ls of Object.values(r.cells)) for (const l of ls) expect(ps).toContain(l.text);
    }
    for (const m of sheet.header.mics) expect(ps).toContain(m);
    for (const c of sheet.header.cast) expect(ps).toContain(c);
    for (const s of sheet.header.staff) expect(ps).toContain(s);
    // no comments, highlights, red text or revisions
    expect(Object.keys(zip.files).some((n) => /comments/i.test(n))).toBe(false);
    expect(text).not.toMatch(/commentRangeStart|commentReference|<w:highlight|w:val="FF0000"|<w:ins |<w:del /);
    const ct = await zip.file('[Content_Types].xml')!.async('string');
    expect(ct).not.toMatch(/comments/);
  });

  it('keeps the timeline on one page (estimated)', async () => {
    const { fit, warnings } = await writeDocx(tpl(sheet), sheet, xml);
    expect(fit.template).toBeGreaterThan(0);
    expect(fit.capacity).toBeGreaterThan(fit.template * 0.8);
    expect(fit.natural).toBeLessThanOrEqual(fit.capacity);
    expect(warnings).toEqual([]);
  });

  it('shades the sermon row and keeps short labels whole', async () => {
    const { text } = await docXml((await writeDocx(tpl(sheet), sheet, xml)).bytes);
    const trs = timelineRows(text).slice(-sheet.rows.length);
    expect(trs).toHaveLength(sheet.rows.length);
    sheet.rows.forEach((r, i) => {
      const fills = trs[i].map((tc) => tc.getElementsByTagNameNS(W, 'shd').item(0)?.getAttributeNS(W, 'fill') ?? null);
      if (r.key === 'sermon') expect(new Set(fills)).toEqual(new Set(['D9D9D9']));
      else expect(fills.every((f) => f === null)).toBe(true);
    });
    // a break may split a label only between items, never inside "보컬 Mic #1-4" or "65%"
    for (const p of paraTexts(text)) expect(p).not.toMatch(/Mic $|Mic #\d+-$|^\s*\d+%/);
    const xmlDoc = new DOMParser().parseFromString(text, 'application/xml');
    const runs = xmlDoc.getElementsByTagNameNS(W, 'r');
    for (let i = 0; i < runs.length; i++) {
      const r = runs.item(i) as Element;
      if (!/Mic #\d+-\d+/.test(r.textContent ?? '')) continue;
      const sz = Number(r.getElementsByTagNameNS(W, 'sz').item(0)?.getAttributeNS(W, 'val'));
      expect(sz).toBeLessThanOrEqual(13);
      expect(sz).toBeGreaterThanOrEqual(10);
    }
  });
});

describe('page layout', () => {
  // where Word 16.115 drew the first service row of these samples (twips from the page top, read from its PDF export)
  const WORD_ROW_START: Record<string, number> = { '1': 6360, '2': 5970, '4': 6600 };
  it.each(sheets.map((s) => [s.label, s] as const))('%s: service rows start where Word puts them', async (_l, sheet) => {
    const { fit } = await writeDocx(tpl(sheet), sheet, xml);
    const measured = WORD_ROW_START[sheet.serviceId];
    expect(fit.top).toBeGreaterThanOrEqual(measured - 10); // never well above Word: that would overstate the room left
    expect(fit.top).toBeLessThanOrEqual(measured + 10);
  });

  it.each(sheets.map((s) => [s.label, s] as const))('%s: the table closes on the template’s thick bottom border', async (_l, sheet) => {
    const { text } = await docXml((await writeDocx(tpl(sheet), sheet, xml)).bytes);
    const rows = timelineRows(text);
    const own = (tc: Element) => tc.getElementsByTagNameNS(W, 'tcBorders').item(0)?.getElementsByTagNameNS(W, 'bottom').item(0);
    // the church's sheets leave the last row to the table's sz12 bottom border; rows above keep their thin rules
    expect(rows[rows.length - 1].every((tc) => !own(tc))).toBe(true);
    expect(rows[rows.length - 2].some((tc) => own(tc))).toBe(true);
  });

  it('warns when a week will not fit on one page', async () => {
    const sheet = sheets.find((s) => s.serviceId === '4')!;
    const dense: Sheet = { ...sheet, rows: [...sheet.rows, ...sheet.rows, ...sheet.rows] };
    const { fit, warnings } = await writeDocx(tpl(sheet), dense, xml);
    expect(fit.natural).toBeGreaterThan(fit.capacity);
    expect(warnings.some((w) => w.includes('한 페이지를 넘을 수 있습니다'))).toBe(true);
  });
});

describe('templates', () => {
  it('rejects a document without a cue sheet table', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    await expect(writeDocx(bytes, sheets[0], xml)).rejects.toBeInstanceOf(TemplateError);
  });

  it('strips comments from a commented template', async () => {
    const sheet = sheets.find((s) => s.serviceId === '4')!;
    const zip = await JSZip.loadAsync(tpl(sheet));
    let d = await zip.file('word/document.xml')!.async('string');
    d = d.replace('<w:body>', '<w:body><w:p><w:commentRangeStart w:id="9"/><w:r><w:t>x</w:t></w:r><w:commentRangeEnd w:id="9"/><w:r><w:commentReference w:id="9"/></w:r></w:p>');
    zip.file('word/document.xml', d);
    zip.file('word/comments.xml', `<w:comments xmlns:w="${W}"/>`);
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
    zip.file('word/_rels/document.xml.rels', rels.replace('</Relationships>', '<Relationship Id="rIdC" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>'));
    const ct = await zip.file('[Content_Types].xml')!.async('string');
    zip.file('[Content_Types].xml', ct.replace('</Types>', '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>'));
    const res = await writeDocx(await zip.generateAsync({ type: 'uint8array' }), sheet, xml);
    const out = await JSZip.loadAsync(res.bytes);
    expect(out.file('word/comments.xml')).toBeNull();
    expect(await out.file('word/document.xml')!.async('string')).not.toMatch(/comment/);
    expect(await out.file('word/_rels/document.xml.rels')!.async('string')).not.toMatch(/comments/);
    expect(await out.file('[Content_Types].xml')!.async('string')).not.toMatch(/comments/);
  });
});
