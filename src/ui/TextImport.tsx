import { useMemo, useState } from 'preact/hooks';
import { parseText, toText } from '../core/parse';
import { FORMAT_HELP, SAMPLE_TEXT } from '../core/sample';
import type { ServiceInput, WeekInput } from '../core/types';
import { alertBox, errorText, openFile, saveFile } from './platform';
import { clone, isName, lastFolder, rules, SIDS } from './store';

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
  for (const k of ['사회', '설교', '인도', '나래이션']) if (s.people[k]) out.push(`${k} ${s.people[k]}`);
  const staff = rules.staffOrder.filter((k) => s.people[k]).length;
  if (staff) out.push(`스태프 ${staff}명`);
  for (const [k, v] of Object.entries(s.lists)) if (v.length) out.push(/찬양/.test(k) ? `${k} ${v.length}곡` : `${k} ${v.length}줄`);
  for (const [k, v] of Object.entries(s.values)) if (v) out.push(k);
  for (const [k, v] of Object.entries(s.specials)) if (v != null) out.push(`${k} ${v ? '포함' : '제외'}`);
  if (s.order?.length) out.push(`순서 ${s.order.length}개`);
  if (s.durations) out.push(`시간 변경 ${Object.keys(s.durations).length}개`);
  const edits = (s.roles?.length ?? 0) + (s.edits?.length ?? 0);
  if (edits) out.push(`직접 수정 ${edits}개`);
  if (s.start) out.push(`시작 ${s.start}`);
  return out.join(' · ') || '(내용 없음)';
}

interface Props {
  week: WeekInput;
  initial: string;
  onApply: (w: WeekInput, services: string[]) => void;
  onClose: () => void;
}

export function TextImport({ week, initial, onApply, onClose }: Props) {
  const [text, setText] = useState(initial);
  const parsed = useMemo(() => parseText(text, week.date, isName), [text, week.date]);
  const found = SIDS.filter((sid) => parsed.week.services[sid].include);
  const blank = !text.split('\n').some((l) => l.trim() && !l.trim().startsWith('#'));

  const apply = () => {
    const next = clone(week);
    next.date = parsed.week.date;
    for (const sid of found) next.services[sid] = parsed.week.services[sid];
    onApply(next, found);
  };
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
      await saveFile(`큐시트 입력 ${parsed.week.date}.txt`, new TextEncoder().encode(text), { name: '텍스트', extensions: ['txt'] }, lastFolder());
    } catch (e) {
      await alertBox(`저장하지 못했습니다: ${errorText(e)}`, 'error');
    }
  };

  return (
    <div class="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal wide" role="dialog" aria-label="텍스트로 입력">
        <div class="modal-head">
          <h2>텍스트로 입력</h2>
          <button class="ghost" onClick={onClose} title="닫기">✕</button>
        </div>
        <div class="modal-body split">
          <div class="col">
            <div class="actions">
              <button onClick={() => setText(toText(week))}>현재 입력 불러오기</button>
              <button onClick={() => setText(SAMPLE_TEXT)}>예시 넣기</button>
              <button onClick={openTxt}>텍스트 파일 열기…</button>
              <button onClick={saveTxt} disabled={blank}>텍스트 파일로 저장…</button>
            </div>
            <textarea
              class="code big"
              value={text}
              spellcheck={false}
              placeholder={'날짜: 2026-10-18\n\n[4부]\n사회: OOO 목사\n설교: OOO 목사\n찬양:\n(찬양팀 메시지 붙여넣기)\n본문: …\n설교제목: …'}
              onInput={(e) => setText(e.currentTarget.value)}
            />
            <div class="recognized">
              {blank ? (
                <span class="muted">예배 정보를 붙여넣거나 적으세요. 오른쪽에 형식이 있습니다.</span>
              ) : (
                <>
                  <div>
                    <b>날짜</b> {parsed.week.date}
                    {parsed.week.date !== week.date && <span class="chip flag">지금 {week.date} → 바뀜</span>}
                  </div>
                  {found.map((sid) => (
                    <div key={sid}>
                      <b>{rules.services[sid].label}</b> {summary(parsed.week.services[sid])}
                    </div>
                  ))}
                  {found.length < SIDS.length && (
                    <div class="muted">
                      {SIDS.filter((s) => !found.includes(s)).map((s) => rules.services[s].label).join(', ')}: 텍스트에 없어 그대로 둡니다
                    </div>
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
            <table class="help-table">
              <tbody>
                {FORMAT_HELP.map(([k, v]) => (
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
          <span class="muted">적용하면 텍스트에 있는 예배({found.map((s) => rules.services[s].label).join(', ') || '없음'})의 입력이 이 내용으로 바뀝니다.</span>
          <button onClick={onClose}>취소</button>
          <button class="primary" disabled={blank || !found.length} onClick={apply}>
            적용
          </button>
        </div>
      </div>
    </div>
  );
}
