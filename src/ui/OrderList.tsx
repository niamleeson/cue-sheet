/**
 * The service's order as one list: every row with its time, minutes and the fields it prints (찬양, 본문 …), the
 * specials among them. Rows are dragged to reorder, ✕ takes one out, + adds a special from the guideline or a row of
 * one's own (to this service or several).
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { fieldsFor, guidelineRows } from '../core/engine';
import { addCustom, addSpecial, removeRow, renameCustom, reorder, restoreRow, setDur, specialAuto } from '../core/ops';
import type { CueDoc, Sheet, SheetRow, SpecialRule } from '../core/types';
import { Change, DocField, isSongKey, LIST_LABEL, NumInput, svcLabel, val } from './fields';
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
}

interface FieldRef { kind: 'lists' | 'values'; key: string; label: string }

const specialOf = (sid: string, id?: string) => (id ? rules.services[sid].specials.find((s) => s.id === id) : undefined);
/** a special that changes more than the one row it adds (turning it off undoes those changes too) */
const bigSpecial = (sp: SpecialRule) => sp.ops.filter((o) => o.op !== 'addMic').length > 1;

export function OrderList({ doc, sid, sheet, services, change, highlight, onHighlight }: Props) {
  const svc = rules.services[sid];
  const defaults = useMemo(() => fieldsFor(svc), [svc]);
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ key: string; to: number } | null>(null);
  const [adding, setAdding] = useState<{ after?: string } | null>(null);
  const keys = sheet.rows.map((r) => r.key);

  // each field is typed once, at the first row that prints it; a special's own fields go with its first row
  const fieldsByRow = useMemo(() => {
    const seen = new Set<string>();
    const out = new Map<string, FieldRef[]>();
    for (const r of sheet.rows) {
      const fs: FieldRef[] = [];
      const add = (kind: 'lists' | 'values', key: string, label: string) => {
        if (seen.has(key)) return;
        seen.add(key);
        fs.push({ kind, key, label });
      };
      const sp = specialOf(sid, r.special);
      const params = new Map((sp?.params ?? []).map((p) => [p.key, p]));
      for (const k of r.fields.lists) add('lists', k, LIST_LABEL[k] ?? params.get(k)?.label ?? k);
      for (const k of r.fields.values) add('values', k, params.get(k)?.label ?? k);
      for (const p of sp?.params ?? []) add(p.list ? 'lists' : 'values', p.key, LIST_LABEL[p.key] ?? p.label);
      out.set(r.key, fs);
    }
    return out;
  }, [sheet, sid]);

  const move = (next: string[]) => {
    if (next.join('\n') !== keys.join('\n')) change((d) => reorder(rules, d, sid, next));
  };

  const startDrag = (e: PointerEvent, key: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const pane = listRef.current?.closest('.pane') as HTMLElement | null;
    let y = e.clientY;
    let to = keys.indexOf(key);
    let raf = 0;
    const tick = () => {
      if (pane) {
        const b = pane.getBoundingClientRect();
        if (y < b.top + 50) pane.scrollTop -= 12;
        else if (y > b.bottom - 50) pane.scrollTop += 12;
      }
      let n = 0;
      for (const el of listRef.current?.querySelectorAll<HTMLElement>('[data-card]') ?? []) {
        if (el.dataset.card === key) continue;
        const r = el.getBoundingClientRect();
        if (y > r.top + r.height / 2) n++;
      }
      if (n !== to) {
        to = n;
        setDrag({ key, to });
      }
      raf = requestAnimationFrame(tick);
    };
    const onMove = (ev: PointerEvent) => (y = ev.clientY);
    const end = (ev: PointerEvent) => {
      cancelAnimationFrame(raf);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      setDrag(null);
      if (ev.type !== 'pointerup') return;
      const next = keys.filter((k) => k !== key);
      next.splice(to, 0, key);
      move(next);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    setDrag({ key, to });
    raf = requestAnimationFrame(tick);
  };
  const nudge = (key: string, by: number) => {
    const i = keys.indexOf(key);
    const j = i + by;
    if (j < 0 || j >= keys.length) return;
    const next = keys.slice();
    next.splice(i, 1);
    next.splice(j, 0, key);
    move(next);
  };

  // where the dragged row would land: before this row (null = at the end); none when it would stay put
  const others = drag ? keys.filter((k) => k !== drag.key) : [];
  const dropBefore = drag ? others[drag.to] ?? null : undefined;
  const stays = drag ? keys[keys.indexOf(drag.key) + 1] === dropBefore || (dropBefore === null && keys[keys.length - 1] === drag.key) : true;

  const remove = async (r: SheetRow) => {
    const sp = specialOf(sid, r.special);
    if (sp && bigSpecial(sp) && !(await confirmBox(`‘${sp.label}’ 특별순서를 뺄까요?\n이 특별순서가 바꾼 다른 순서도 가이드라인대로 돌아갑니다.`, '빼기'))) return;
    change((d) => removeRow(rules, d, sid, r.key));
    if (highlight === r.key) onHighlight(null);
  };

  const row = (r: SheetRow) => {
    const sp = specialOf(sid, r.special);
    const fields = fieldsByRow.get(r.key) ?? [];
    const changed = r.ruleDur != null && r.dur !== r.ruleDur;
    const xTitle = r.custom ? '이 순서 지우기' : sp ? `‘${sp.label}’ 특별순서 빼기` : '이번 주 순서에서 빼기 (아래 “빠진 순서”에서 되살릴 수 있습니다)';
    return (
      <div
        key={r.key}
        id={`card-${r.key}`}
        data-card={r.key}
        class={`row-card ${sp ? 'special' : ''} ${r.custom ? 'custom' : ''} ${highlight === r.key ? 'hl' : ''} ${drag?.key === r.key ? 'dragging' : ''}`}
      >
        {drag && !stays && dropBefore === r.key && <div class="drop-line" />}
        <div class="row-head">
          <button
            class="handle"
            title="끌어서 순서 바꾸기 (Alt + ↑/↓ 로도 옮길 수 있습니다)"
            aria-label={`${r.name} 옮기기`}
            onPointerDown={(e) => startDrag(e as PointerEvent, r.key)}
            onKeyDown={(e) => {
              if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
              e.preventDefault();
              nudge(r.key, e.key === 'ArrowUp' ? -1 : 1);
            }}
          >
            ⋮⋮
          </button>
          <span class="row-start mono" onClick={() => onHighlight(highlight === r.key ? null : r.key)} title="미리보기에서 이 순서 표시">{r.start}</span>
          {r.custom ? (
            <input class="row-name custom" value={r.name} title="직접 추가한 순서 이름 (이 순서가 있는 모든 예배에서 바뀝니다)" onInput={(e) => { const t = val(e); if (t.trim()) change((d) => renameCustom(d, r.key, t)); }} />
          ) : (
            <span class="row-name" onClick={() => onHighlight(highlight === r.key ? null : r.key)}>{r.name}</span>
          )}
          {sp && <span class={`chip ${sp.source.kind === 'supplement' ? 'supp' : 'sp'}`} title={sp.source.note ?? '가이드라인 특별순서'}>{sp.label}</span>}
          {r.custom && <span class="chip user">직접 추가</span>}
          <span class="row-dur">
            <NumInput
              value={r.dur}
              placeholder={r.ruleDur != null ? String(r.ruleDur) : ''}
              changed={changed}
              title={r.ruleDur != null ? `가이드라인 ${r.ruleDur}분` : '분'}
              onCommit={(n) => change((d) => setDur(d, sid, r.key, n, r.ruleDur))}
            />
            <span class="muted small">분</span>
          </span>
          <button class="ghost row-x" title={xTitle} onClick={() => remove(r)}>✕</button>
        </div>
        {changed && <div class="hint row-note">가이드라인 {r.ruleDur}분</div>}
        {sp?.notes.map((n, i) => <div key={i} class="hint warn row-note">⚠︎ {n}</div>)}
        {fields.length > 0 && (
          <div class="row-fields">
            {fields.map((f) => (
              <DocField
                key={f.key}
                doc={doc}
                sid={sid}
                kind={f.kind}
                k={f.key}
                label={f.label}
                change={change}
                splitSongs={f.key === '찬양1' && sheet.rows.some((x) => x.fields.lists.includes('찬양2'))}
                placeholder={f.kind === 'lists' ? (defaults.lists.get(f.key) ?? []).join('\n') : defaults.scalars.get(f.key) ?? ''}
                hint={
                  f.key === '찬양1' ? '찬양팀 메시지를 통째로 붙여넣어도 됩니다 — 링크·번호를 지우고 “-- 광고 --” 뒤의 곡은 찬양 2로 옮깁니다'
                    : f.kind === 'lists' && isSongKey(f.key) ? '한 줄에 한 곡 (붙여넣은 링크·번호는 자동 정리)' : undefined
                }
              />
            ))}
          </div>
        )}
        {adding?.after !== r.key && <button class="row-add" title="이 순서 뒤에 순서 추가" aria-label="이 순서 뒤에 순서 추가" onClick={() => setAdding({ after: r.key })}><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1v8M1 5h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg></button>}
        {adding?.after === r.key && <AddMenu doc={doc} sid={sid} services={services} after={r.key} afterName={r.name} change={change} onClose={() => setAdding(null)} />}
      </div>
    );
  };

  return (
    <>
      <section>
        <h3>순서</h3>
        <div class={`order-list ${drag ? 'is-dragging' : ''}`} ref={listRef}>
          {sheet.rows.map(row)}
          {drag && !stays && dropBefore === null && <div class="drop-line end" />}
        </div>
        {adding && adding.after == null ? (
          <AddMenu doc={doc} sid={sid} services={services} change={change} onClose={() => setAdding(null)} />
        ) : (
          <div class="actions">
            <button onClick={() => setAdding({})}>+ 특별순서</button>
            <span class="muted">끝 {sheet.end}</span>
          </div>
        )}
      </section>
      {sheet.removed.length > 0 && (
        <section>
          <h3>빠진 순서</h3>
          <div class="removed">
            {sheet.removed.map((r) => (
              <span key={r.key} class="removed-item">
                {r.name}
                <button class="link" onClick={() => change((d) => restoreRow(d, sid, r.key))}>되살리기</button>
              </span>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/** + 특별순서: a special from the guideline (at its own place) or a row of one's own, for one or more services. */
function AddMenu({ doc, sid, services, after, afterName, change, onClose }: { doc: CueDoc; sid: string; services: string[]; after?: string; afterName?: string; change: Change; onClose: () => void }) {
  const [picked, setPicked] = useState<string[]>(services);
  const [title, setTitle] = useState('');
  const [dur, setDur] = useState<number | undefined>(5);
  const titleRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    boxRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    titleRef.current?.focus({ preventScroll: true });
  }, []);
  const targets = services.filter((s) => picked.includes(s));
  // specials of the picked services, in this service's order first
  const specials = useMemo(() => {
    const out = new Map<string, { id: string; label: string; in: string[]; on: string[] }>();
    for (const s of [sid, ...services.filter((x) => x !== sid)]) {
      for (const sp of rules.services[s].specials) {
        const e = out.get(sp.id) ?? { id: sp.id, label: sp.label, in: [], on: [] };
        e.in.push(s);
        out.set(sp.id, e);
      }
    }
    return [...out.values()];
  }, [sid, services]);
  // in this week's order already: switched on (or on by the guideline) and none of its rows taken out
  const included = (id: string, s: string) => {
    const sd = doc.services[s];
    if (!(sd?.specials[id] ?? specialAuto(rules, doc, s, id))) return false;
    return !guidelineRows(rules, doc, s).some((r) => r.special === id && sd.off.includes(r.key));
  };
  const addKnown = (id: string) => {
    change((d) => addSpecial(rules, d, targets, id));
    onClose();
  };
  const addOwn = () => {
    const t = title.trim();
    if (!t || !targets.length) return;
    change((d) => void addCustom(rules, d, targets, t, dur ?? 0, after));
    onClose();
  };
  return (
    <div class="add-menu" ref={boxRef} onKeyDown={(e) => e.key === 'Escape' && !e.isComposing && e.keyCode !== 229 && onClose()}>
      <div class="add-head">
        <b>{afterName ? `‘${afterName}’ 뒤에 순서 추가` : '순서 추가'}</b>
        <button class="ghost" title="닫기" onClick={onClose}>✕</button>
      </div>
      {services.length > 1 && (
        <div class="add-scope">
          <span class="field-label">적용할 예배</span>
          {services.map((s) => (
            <label key={s} class="check">
              <input type="checkbox" checked={picked.includes(s)} onChange={(e) => setPicked((p) => (e.currentTarget.checked ? [...p, s] : p.filter((x) => x !== s)))} />
              {svcLabel(s)}
            </label>
          ))}
        </div>
      )}
      <div class="field-label">가이드라인 특별순서 <span class="muted">— 가이드라인이 정한 자리에 들어갑니다</span></div>
      <div class="add-specials">
        {specials.map((sp) => {
          const where = targets.filter((s) => sp.in.includes(s));
          const missing = where.filter((s) => !included(sp.id, s));
          const only = sp.in.length < services.length ? ` (${sp.in.map(svcLabel).join(', ')}만)` : '';
          return (
            <button key={sp.id} disabled={!missing.length} title={!where.length ? '고른 예배에는 이 특별순서가 없습니다' : !missing.length ? '이미 들어 있습니다' : `${missing.map(svcLabel).join(', ')}에 추가`} onClick={() => addKnown(sp.id)}>
              {sp.label}
              {only && <span class="muted small">{only}</span>}
              {where.length > 0 && !missing.length && <span class="muted small"> ✓</span>}
            </button>
          );
        })}
      </div>
      <div class="field-label">직접 입력 <span class="muted">— 가이드라인에 없는 순서 (담당·음향 등은 미리보기에서 칸을 눌러 입력)</span></div>
      <div class="add-own">
        <input
          value={title}
          placeholder="예: 환영 인사, 특별 찬양"
          onInput={(e) => setTitle(val(e))}
          onKeyDown={(e) => e.key === 'Enter' && !e.isComposing && addOwn()}
          ref={titleRef}
        />
        <NumInput value={dur} placeholder="분" onCommit={setDur} />
        <span class="muted small">분</span>
        <button class="primary" disabled={!title.trim() || !targets.length} onClick={addOwn}>추가</button>
      </div>
    </div>
  );
}
