/**
 * The left panel: one service of the open cue sheet. Basics (start, Mic counts), the people, the order with the
 * fields each row prints, and the cell changes made in the preview (변경 사항).
 */
import { useState } from 'preact/hooks';
import { occasionOf } from '../core/doc';
import { EDIT_COL_LABELS } from '../core/engine';
import { describeOp } from '../core/lineops';
import { copyPeople, setCount, setStart } from '../core/ops';
import type { CellEdit, CueDoc, EditCol, Sheet } from '../core/types';
import { DocField, Field, NumInput, PEOPLE_HINT, svcLabel, val } from './fields';
import type { Change } from './fields';
import { OrderList } from './OrderList';
import { confirmBox } from './platform';
import { rules } from './store';

interface Props {
  doc: CueDoc;
  sid: string;
  sheet: Sheet;
  services: string[];
  change: Change;
  highlight: string | null;
  onHighlight: (key: string | null) => void;
  /** opens a cell in the preview's editor */
  onOpenCell: (row: string, col: EditCol) => void;
}

/** A row's name even when it is not in this week's order. */
export function rowLabel(doc: CueDoc, sid: string, sheet: Sheet, key: string): string {
  if (key === 'header') return '머리글';
  if (key === 'rehearsal') return '리허설';
  const hit = sheet.rows.find((r) => r.key === key) ?? sheet.removed.find((r) => r.key === key);
  if (hit) return hit.name;
  const svc = rules.services[sid];
  const rule = svc.rows.find((r) => r.key === key) ?? svc.specials.flatMap((sp) => sp.ops.flatMap((o) => ('row' in o ? [o.row] : []))).find((r) => r.key === key);
  if (rule) return rule.name;
  for (const sd of Object.values(doc.services)) for (const m of sd.moves) if (m.key === key && m.title != null) return m.title;
  return key;
}

export function ServiceForm({ doc, sid, sheet, services, change, highlight, onHighlight, onOpenCell }: Props) {
  const svc = rules.services[sid];
  const sd = doc.services[sid];
  const occ = occasionOf(rules, doc.kind);
  const people = (k: string, label: string) => (
    <DocField key={k} doc={doc} sid={sid} kind="people" k={k} label={label} placeholder={PEOPLE_HINT[k] ?? ''} services={services} change={change} />
  );
  const startChanged = sd.start != null && sd.start !== svc.start;

  return (
    <div class="form">
      {occ.note && doc.kind !== 'sunday' && <div class="notice event-note">{occ.note}</div>}
      <section>
        <div class="grid">
          <Field label="시작 시간" hint={startChanged ? `가이드라인 ${svc.start}` : undefined}>
            <input type="time" class={startChanged ? 'changed' : ''} value={sd.start ?? svc.start} onInput={(e) => { const v = val(e); change((d) => setStart(rules, d, sid, v)); }} />
          </Field>
          <Field label="보컬 Mic 수">
            <NumInput value={sd.vocals} placeholder={String(svc.defaults.vocals)} max={20} onCommit={(n) => change((d) => setCount(rules, d, sid, 'vocals', n))} />
          </Field>
          <Field label="인도자 Mic 수">
            <NumInput value={sd.leaders} placeholder={String(svc.defaults.leaders)} max={5} onCommit={(n) => change((d) => setCount(rules, d, sid, 'leaders', n))} />
          </Field>
        </div>
      </section>

      <section>
        <h3>출연</h3>
        <div class="grid">{svc.cast.map(([k, label, optional]) => people(k, optional ? `${label} (없으면 비움)` : label))}</div>
      </section>

      <section>
        <h3>
          스태프
          {services.length > 1 && (
            <select
              class="mini"
              value=""
              onChange={(e) => {
                const from = val(e);
                e.currentTarget.value = '';
                if (from) change((d) => copyPeople(d, from, sid, rules.staffOrder));
              }}
            >
              <option value="">다른 예배에서 복사…</option>
              {services.filter((x) => x !== sid).map((x) => (
                <option key={x} value={x}>{svcLabel(x)}</option>
              ))}
            </select>
          )}
        </h3>
        <div class="grid">{rules.staffOrder.map((k) => people(k, k))}</div>
      </section>

      <OrderList doc={doc} sid={sid} sheet={sheet} services={services} change={change} highlight={highlight} onHighlight={onHighlight} />
      <EditList doc={doc} sid={sid} sheet={sheet} change={change} onOpenCell={onOpenCell} />
    </div>
  );
}

/** 변경 사항 (고급): the cell changes typed in the preview that this service shows, each one can be undone here. */
function EditList({ doc, sid, sheet, change, onOpenCell }: { doc: CueDoc; sid: string; sheet: Sheet; change: Change; onOpenCell: (row: string, col: EditCol) => void }) {
  const edits = doc.edits.filter((e) => e.services.includes(sid));
  const [open, setOpen] = useState<boolean | null>(null);
  const present = (e: CellEdit) => e.row === 'header' || e.row === 'rehearsal' || sheet.rows.some((r) => r.key === e.row);
  const undo = async (e: CellEdit) => {
    const where = rowLabel(doc, sid, sheet, e.row);
    const more = e.services.length > 1 ? `\n(${svcLabel(sid)}에서만 되돌립니다 — ${e.services.filter((s) => s !== sid).map(svcLabel).join(', ')}은(는) 그대로)` : '';
    if (!(await confirmBox(`‘${where} · ${EDIT_COL_LABELS[e.col]}’ 칸의 변경을 되돌릴까요?${more}`, '되돌리기'))) return;
    change((d) => {
      for (const x of d.edits) if (x.id === e.id) x.services = x.services.filter((s) => s !== sid);
      d.edits = d.edits.filter((x) => x.services.length);
    });
  };
  return (
    <details class="section edits" open={open ?? edits.length > 0} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <h3>
          변경 사항 (고급) {edits.length > 0 && <span class="badge info">{edits.length}</span>}
        </h3>
      </summary>
      <p class="hint">
        미리보기에서 칸을 눌러 직접 고친 내용입니다. 찬양·본문처럼 입력 칸이 있는 내용은 입력 칸에 저장되고, 나머지는 여기에 줄 단위 변경으로
        저장되어 다음 큐시트에도 이어집니다.
      </p>
      {edits.map((e) => {
        const here = present(e);
        const bad = here && sheet.editStatus[e.id] === false;
        const lines = [...e.ops.map(describeOp), ...(e.also ?? []).flatMap((a) => a.ops.map((o) => `${EDIT_COL_LABELS[a.col]}: ${describeOp(o)}`))];
        return (
          <div key={e.id} class={`edit-item ${here ? 'link' : 'gone'}`} title={here ? '미리보기에서 이 칸 열기' : undefined} onClick={() => here && onOpenCell(e.row, e.col)}>
            <div class="edit-head">
              <b>{rowLabel(doc, sid, sheet, e.row)}</b>
              <span class="muted">· {EDIT_COL_LABELS[e.col]}</span>
              <span class="chip">{e.services.length > 1 ? e.services.map(svcLabel).join('·') : '이 예배만'}</span>
              {!here && <span class="chip flag">이번 주 없음</span>}
              {bad && <span class="chip flag" title="고친 줄을 찾지 못해 일부가 적용되지 않았습니다">적용 안 됨</span>}
              <button class="ghost undo" title="이 변경 되돌리기" onClick={(ev) => { ev.stopPropagation(); void undo(e); }}>↺</button>
            </div>
            {e.note && <div class="hint">{e.note}</div>}
            <ul>
              {lines.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </div>
        );
      })}
      {!edits.length && <p class="muted small">아직 없습니다.</p>}
    </details>
  );
}
