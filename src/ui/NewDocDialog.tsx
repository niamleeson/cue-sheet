import { useState } from 'preact/hooks';
import { docId, emptyDoc, occasionOf } from '../core/doc';
import { sundayIndex } from '../core/engine';
import { COPY_DEFAULT, copyDoc } from '../core/ops';
import type { CopyParts } from '../core/ops';
import type { CueDoc, Kind } from '../core/types';
import { confirmBox } from './platform';
import { addDays, isValidDate, rules, weekdayOf } from './store';

export const ORDINAL = ['', '첫째', '둘째', '셋째', '넷째', '다섯째'];
export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const pad = (n: number) => String(n).padStart(2, '0');
export const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The occasion's next day (주일, 수요일) from today on that has no cue sheet yet; today for the other events. */
export function suggestDate(kind: Kind, taken: (id: string) => boolean): string {
  const wd = occasionOf(rules, kind).weekday;
  let d = today();
  if (wd == null) return d;
  d = addDays(d, (wd - weekdayOf(d) + 7) % 7);
  for (let i = 0; i < 52 && taken(docId(kind, d)); i++) d = addDays(d, 7);
  return d;
}

/** “셋째 주일”, “(수)” … */
export function dateHint(kind: Kind, date: string): { text: string; warn: boolean } {
  if (!isValidDate(date)) return { text: '날짜 오류', warn: true };
  const wd = occasionOf(rules, kind).weekday;
  const w = weekdayOf(date);
  if (kind === 'sunday') return w === 0 ? { text: `${ORDINAL[sundayIndex(date)] ?? ''} 주일`, warn: false } : { text: `(${WEEKDAYS[w]}) 일요일이 아닙니다`, warn: true };
  if (wd != null && w !== wd) return { text: `(${WEEKDAYS[w]}) ${WEEKDAYS[wd]}요일이 아닙니다`, warn: true };
  return { text: `(${WEEKDAYS[w]})`, warn: false };
}

const PARTS: [keyof CopyParts, string, string][] = [
  ['people', '출연·스태프·Mic 수', '사람과 마이크 수'],
  ['order', '순서·시간', '바꾼 순서, 분, 시작 시간, 직접 추가한 순서'],
  ['edits', '미리보기에서 고친 칸', '변경 사항 (고급)'],
  ['specials', '특별순서 켜기/끄기', '켜지 않으면 가이드라인대로 (성찬식 첫째 주일, 비전헌금 둘째 주일)'],
  ['content', '찬양·본문 등 내용', '찬양, 본문, 설교제목, 봉헌위원 …'],
];

interface Props {
  kind: Kind;
  /** saved cue sheets of this occasion */
  docs: CueDoc[];
  onCreate: (doc: CueDoc) => void;
  onClose: () => void;
}

export function NewDocDialog({ kind, docs, onCreate, onClose }: Props) {
  const occ = occasionOf(rules, kind);
  const ids = new Set(docs.map((d) => d.id));
  const sorted = docs.slice().sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
  const [date, setDate] = useState(() => suggestDate(kind, (id) => ids.has(id)));
  const [from, setFrom] = useState(sorted[0]?.id ?? '');
  const [parts, setParts] = useState<CopyParts>(COPY_DEFAULT);
  const ok = isValidDate(date) && Number(date.slice(0, 4)) >= 2000;
  const hint = dateHint(kind, date);
  const exists = ok && ids.has(docId(kind, date));

  const create = async () => {
    if (!ok) return;
    if (exists && !(await confirmBox(`${date} ${occ.label} 큐시트가 이미 있습니다. 새로 만든 내용으로 바꿀까요?`, '바꾸기'))) return;
    const prev = docs.find((d) => d.id === from);
    onCreate(prev ? copyDoc(rules, prev, date, parts) : emptyDoc(rules, kind, date));
  };

  return (
    <div class="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal" role="dialog" aria-label="새 큐시트">
        <div class="modal-head">
          <h2>새 큐시트 — {occ.label}</h2>
          <button class="ghost" onClick={onClose} title="닫기">✕</button>
        </div>
        <div class="modal-body">
          <div class="field wide">
            <span class="field-label">날짜</span>
            <div class="row-inline">
              <input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} />
              <span class={hint.warn ? 'warn-text' : 'muted'}>{hint.text}</span>
              {exists && <span class="chip flag">이미 있음</span>}
            </div>
          </div>
          <div class="field wide">
            <span class="field-label">시작할 내용</span>
            <select value={from} onChange={(e) => setFrom(e.currentTarget.value)}>
              {sorted.map((d) => (
                <option key={d.id} value={d.id}>{d.date} {dateHint(kind, d.date).text} 큐시트에서</option>
              ))}
              <option value="">빈 큐시트 (가이드라인 그대로)</option>
            </select>
          </div>
          {from && (
            <div class="field wide">
              <span class="field-label">가져올 것</span>
              {PARTS.map(([k, label, sub]) => (
                <label key={k} class="check block">
                  <input type="checkbox" checked={parts[k]} onChange={(e) => { const on = e.currentTarget.checked; setParts((p) => ({ ...p, [k]: on })); }} />
                  {label} <span class="muted small">{sub}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div class="modal-foot">
          <button onClick={onClose}>취소</button>
          <button class="primary" disabled={!ok} onClick={create}>만들기</button>
        </div>
      </div>
    </div>
  );
}
