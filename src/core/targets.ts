import { HEADER_LABELS, TIMELINE_LABELS } from './docx';
import type { PageRender } from './render';
import type { EditCol, Sheet } from './types';

/** A cell of the page that can be clicked to edit it (pt, page coordinates). */
export interface CellTarget { row: string; col: EditCol; x: number; y: number; w: number; h: number }

/** empty room (pt) under the sound list that is still worth its own 영상 target */
const MIN_ROOM = 8;

/**
 * The editable cells of a rendered page: every cell of the cue sheet table below its column heads (rehearsal and order
 * rows) and the header's 프로그램 진행 / 출연 blocks; 체크사항 is split into its sound list and its videos.
 */
export function cellTargets(page: PageRender, sheet: Sheet): CellTarget[] {
  const out: CellTarget[] = [];
  const { table: tt, first } = page.timeline;
  const heads = page.tables[tt] ?? [];
  const ht = page.tables.findIndex((labels, i) => i !== tt && !!labels?.some((l) => HEADER_LABELS[l] === 'check'));
  for (const c of page.cells) {
    if (c.row === 0) continue;
    const box = { x: c.x, y: c.y, w: c.w, h: c.h };
    if (c.table === tt) {
      const col = TIMELINE_LABELS[heads[c.g0]];
      if (!col) continue;
      if (c.row < first) out.push({ row: 'rehearsal', col: col === 'light' ? (c.row === 1 ? 'lightA' : 'lightB') : col, ...box });
      else {
        const r = sheet.rows[c.row - first];
        if (r) out.push({ row: r.key, col, ...box });
      }
    } else if (c.table === ht && c.row === 1) {
      const kind = HEADER_LABELS[page.tables[ht][c.g0]];
      if (kind === 'staff' || kind === 'cast') out.push({ row: 'header', col: kind, ...box });
      else if (kind === 'check') {
        const end = c.y + c.h;
        const vi = c.paras.findIndex((p) => p.text.trim().startsWith('■영상'));
        const filled = c.paras.filter((p) => p.text.trim());
        const split = vi >= 0 ? c.paras[vi].y : filled.length ? Math.max(...filled.map((p) => p.y + p.h)) : end;
        if (vi < 0 && end - split < MIN_ROOM) out.push({ row: 'header', col: 'mics', ...box });
        else {
          out.push({ row: 'header', col: 'mics', ...box, h: split - c.y });
          out.push({ row: 'header', col: 'videos', ...box, y: split, h: end - split });
        }
      }
    }
  }
  return out;
}
