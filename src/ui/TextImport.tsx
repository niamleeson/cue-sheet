import { useMemo, useState } from 'preact/hooks';
import { docId, occasionOf } from '../core/doc';
import { importWeek } from '../core/migrate';
import { parseCtx, parseText } from '../core/parse';
import type { ParseCtx } from '../core/parse';
import { FORMAT_HELP, SAMPLE_TEXT } from '../core/sample';
import type { CueDoc, ServiceInput } from '../core/types';
import { alertBox, errorText, openFile, saveFile } from './platform';
import { isName, lastFolder, rules } from './store';

/** Decodes a text file: UTF-8, or Korean Windows encoding (CP949) for older Notepad files. */
export function decodeText(data: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return new TextDecoder('euc-kr').decode(data);
  }
}

function summary(s: ServiceInput): string {
  const out: string[] = [];
  const staff = new Set(rules.staffOrder);
  for (const [k, v] of Object.entries(s.people)) if (v && !staff.has(k)) out.push(`${k} ${v}`);
  const n = rules.staffOrder.filter((k) => s.people[k]).length;
  if (n) out.push(`스태프 ${n}명`);
  for (const [k, v] of Object.entries(s.lists)) if (v.length) out.push(/찬양|곡$|송$/.test(k) ? `${k} ${v.length}곡` : `${k} ${v.length}줄`);
  for (const [k, v] of Object.entries(s.values)) if (v) out.push(k);
  for (const [k, v] of Object.entries(s.specials)) if (v != null) out.push(`${k} ${v ? '포함' : '제외'}`);
  if (s.order?.length) out.push(`순서 ${s.order.length}개`);
  if (s.durations) out.push(`시간 변경 ${Object.keys(s.durations).length}개`);
  const edits = (s.roles?.length ?? 0) + (s.edits?.length ?? 0);
  if (edits) out.push(`칸 변경 ${edits}개`);
  if (s.start) out.push(`시작 ${s.start}`);
  return out.join(' · ') || '(내용 없음)';
}

/** The keys an event's text may use (the 주일 help lists the 1부·2부·4부 format). */
function eventHelp(ctx: ParseCtx): [string, string][] {
  const rows: [string, string][] = [['날짜: 2026-12-24', '날짜 (없으면 지금 큐시트 날짜)']];
  const staff = new Set(rules.staffOrder);
  const cast = ctx.people.filter((k) => !staff.has(k));
  if (cast.length) rows.push([cast.map((k) => `${k}: 이름`).join('\n'), '출연']);
  rows.push([`${rules.staffOrder[0]}: 이름\n${rules.staffOrder[1]}: 이름 …`, `스태프 (${rules.staffOrder.join(', ')})`]);
  for (const k of ctx.lists) rows.push([`${k}:\n…\n…`, '한 줄에 하나씩 (찬양팀 메시지를 그대로 붙여넣어도 됩니다)']);
  for (const k of ctx.values) rows.push([`${k}: …`, '']);
  for (const k of ctx.specials) rows.push([`${k}: 예`, '특별순서 넣기 (아니오 = 빼기)']);
  rows.push(['순서:\n환영 5\n…', '순서와 분 (이 예배의 순서를 이대로 바꿉니다)']);
  rows.push(['시간:\n설교 30', '분만 바꾸기']);
  return rows;
}

interface Props {
  doc: CueDoc;
  lib: Record<string, CueDoc>;
  initial: string;
  onApply: (next: CueDoc, found: string[]) => void;
  onClose: () => void;
}

export function TextImport({ doc, lib, initial, onApply, onClose }: Props) {
  const [text, setText] = useState(initial);
  const occ = occasionOf(rules, doc.kind);
  const ctx = useMemo(() => parseCtx(rules, doc.kind), [doc.kind]);
  const parsed = useMemo(() => parseText(text, doc.date, isName, ctx), [text, doc.date, ctx]);
  const ids = ctx.services.map((s) => s.id);
  const found = ids.filter((sid) => parsed.week.services[sid]?.include);
  const blank = !text.split('\n').some((l) => l.trim() && !l.trim().startsWith('#'));
  const date = parsed.week.date;
  const base = date === doc.date ? doc : lib[docId(doc.kind, date)] ?? null;
  const label = (sid: string) => rules.services[sid].label;
  const help = doc.kind === 'sunday' ? FORMAT_HELP : eventHelp(ctx);

  const apply = () => onApply(importWeek(rules, base, parsed.week, doc.kind), found);
  const openTxt = async () => {
    try {
      const f = await openFile({ name: '텍스트', extensions: ['txt'] });
      if (f) setText(decodeText(f.data));
    } catch (e) {
      await alertBox(`파일을 열 수 없습니다: ${errorText(e)}`, 'error');
    }
  };
  const saveTxt = async () => {
    try {
      await saveFile(`큐시트 입력 ${occ.label} ${date}.txt`, new TextEncoder().encode(text), { name: '텍스트', extensions: ['txt'] }, lastFolder());
    } catch (e) {
      await alertBox(`저장하지 못했습니다: ${errorText(e)}`, 'error');
    }
  };
  const placeholder = doc.kind === 'sunday'
    ? '날짜: 2026-10-18\n\n[공통]\n설교: OOO 목사\n본문: …\n설교제목: …\n\n[4부]\n사회: OOO 목사\n찬양:\n(찬양팀 메시지 붙여넣기)'
    : `날짜: ${doc.date}\n${eventHelp(ctx).slice(1, 3).map(([k]) => k.split('\n')[0]).join('\n')}`;

  return (
    <div class="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal wide" role="dialog" aria-label="텍스트로 입력">
        <div class="modal-head">
          <h2>텍스트로 입력 — {occ.label}</h2>
          <button class="ghost" onClick={onClose} title="닫기">✕</button>
        </div>
        <div class="modal-body split">
          <div class="col">
            <div class="actions">
              {doc.kind === 'sunday' && <button onClick={() => setText(SAMPLE_TEXT.replace(/^날짜:.*$/m, `날짜: ${doc.date}`))}>예시 넣기</button>}
              <button onClick={openTxt}>텍스트 파일 열기…</button>
              <button onClick={saveTxt} disabled={blank}>텍스트 파일로 저장…</button>
            </div>
            <textarea class="code big" value={text} spellcheck={false} placeholder={placeholder} onInput={(e) => setText(e.currentTarget.value)} />
            <div class="recognized">
              {blank ? (
                <span class="muted">예배 정보를 붙여넣거나 적으세요. 오른쪽에 형식이 있습니다.</span>
              ) : (
                <>
                  <div>
                    <b>날짜</b> {date}
                    {date !== doc.date && <span class="chip flag">{base ? `저장된 ${date} 큐시트에 합칩니다` : `${date} 새 큐시트를 만듭니다`}</span>}
                  </div>
                  {found.map((sid) => (
                    <div key={sid}>
                      <b>{label(sid)}</b> {summary(parsed.week.services[sid])}
                    </div>
                  ))}
                  {found.length < ids.length && found.length > 0 && (
                    <div class="muted">{ids.filter((s) => !found.includes(s)).map(label).join(', ')}: 텍스트에 없어 그대로 둡니다</div>
                  )}
                  {parsed.warnings.map((w, i) => (
                    <div key={i} class="hint warn">⚠︎ {w}</div>
                  ))}
                </>
              )}
            </div>
          </div>
          <div class="col help">
            <h4>형식</h4>
            {ids.length > 1 && <p class="hint">[1부] 같은 구역 아래 줄은 그 예배에만, 구역 없이 쓰거나 [공통] 아래 쓴 줄은 모든 예배에 들어갑니다.</p>}
            <table class="help-table">
              <tbody>
                {help.map(([k, v]) => (
                  <tr key={k}>
                    <td class="code">{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div class="modal-foot">
          <span class="muted">텍스트에 있는 내용만 바뀌고 나머지 입력은 그대로입니다.</span>
          <button onClick={onClose}>취소</button>
          <button class="primary" disabled={blank || !found.length} onClick={apply}>
            적용
          </button>
        </div>
      </div>
    </div>
  );
}
