import type { LineOp, OutLine } from './types';

/** Text used to match lines: NFC, single spaces, trimmed. */
export const lineKey = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

const HANGUL = /[가-힣]/;
/** Replaces `from` where it is a whole word (not part of a longer Hangul word). No regex lookbehind: older WebKit lacks it. */
export function replaceWord(s: string, from: string, to: string): string {
  if (!from) return s;
  let out = '', i = 0;
  for (;;) {
    const j = s.indexOf(from, i);
    if (j < 0) return out + s.slice(i);
    const whole = !HANGUL.test(s[j - 1] ?? '') && !HANGUL.test(s[j + from.length] ?? '');
    out += s.slice(i, j) + (whole ? to : from);
    i = j + from.length;
  }
}

/** A typed line; a leading ** makes it bold. */
export const outLine = (s: string): OutLine => (s.startsWith('**') ? { text: s.slice(2), bold: true } : { text: s });

/** Applies line changes in order. `ok` is false when a line to change was not found (the edit no longer fits). */
export function applyOps(lines: OutLine[], ops: LineOp[]): { lines: OutLine[]; ok: boolean } {
  let out = lines.slice();
  let ok = true;
  const find = (s: string) => {
    const k = lineKey(s);
    return out.findIndex((l) => lineKey(l.text) === k);
  };
  for (const op of ops) {
    switch (op.op) {
      case 'remove': {
        const i = find(op.line);
        if (i < 0) ok = false; else out.splice(i, 1);
        break;
      }
      case 'replace': {
        const i = find(op.line);
        if (i < 0) { ok = false; break; }
        const n = outLine(op.with);
        out[i] = { text: n.text, ...(n.bold || out[i].bold ? { bold: true } : {}) };
        break;
      }
      case 'insert': {
        if (op.after == null) { out.unshift(outLine(op.line)); break; }
        const i = find(op.after);
        if (i < 0) { ok = false; out.push(outLine(op.line)); } else out.splice(i + 1, 0, outLine(op.line));
        break;
      }
      case 'append': out.push(outLine(op.line)); break;
      case 'set': out = op.lines.map(outLine); break;
      case 'sub': {
        let hit = false;
        out = out.map((l) => {
          const t = replaceWord(l.text, op.from, op.to);
          if (t === l.text) return l;
          hit = true;
          return { text: t, ...(l.bold ? { bold: true } : {}) };
        });
        if (!hit) ok = false;
        break;
      }
    }
  }
  return { lines: out, ok };
}

/** Short Korean description of an op for the 변경 사항 list. */
export function describeOp(op: LineOp): string {
  const q = (s: string) => `‘${s}’`;
  switch (op.op) {
    case 'remove': return `${q(op.line)} 삭제`;
    case 'replace': return `${q(op.line)} → ${q(op.with)}`;
    case 'insert': return `${q(op.line)} 추가`;
    case 'append': return `${q(op.line)} 추가`;
    case 'set': return `전체 → ${op.lines.map(q).join(' / ') || '(빈 칸)'}`;
    case 'sub': return `${q(op.from)} → ${q(op.to)}`;
  }
}
