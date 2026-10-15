import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { fieldsFor, norm, rowNamesFor } from '../core/engine';
import { editLines, parseEdits, parseSongs } from '../core/parse';
import type { ServiceInput, Sheet, SheetRow } from '../core/types';
import { confirmBox } from './platform';
import { isName, rules, SIDS } from './store';
import type { Mut } from './store';

const LIST_LABEL: Record<string, string> = {
  찬양: '찬양', 찬양1: '찬양 1 (광고 전)', 찬양2: '찬양 2 (광고 후)', 본문: '성경 본문', 설교제목: '설교 제목',
  봉헌찬양: '봉헌 찬양', 축도찬양: '축도 찬양', 마무리찬양: '마무리 찬양', 성가대찬양: '성가대 찬양', 선교지: '선교지', 과정: '수료 과정',
};
const PEOPLE_HINT: Record<string, string> = { 사회: 'OOO 목사', 설교: 'OOO 목사', 인도: 'OOO 전도사', 나래이션: 'OOO' };
const EDIT_EXAMPLE = `담당변경:
성경 봉독: 사회자 -> 봉독자
추가:
설교 | 세부사항 | -마무리 기도시 밴드 등단 (상수)
변경:
강사소개 | 세부사항 | -설교자 등단`;

const isSongKey = (k: string) => /찬양/.test(k);
const val = (e: Event) => (e.currentTarget as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;

function Field({ label, hint, children, wide }: { label: string; hint?: ComponentChildren; children: ComponentChildren; wide?: boolean }) {
  return (
    <label class={`field ${wide ? 'wide' : ''}`}>
      <span class="field-label">{label}</span>
      {children}
      {hint && <span class="hint">{hint}</span>}
    </label>
  );
}

/** Number box that lets the user clear it while typing; commits whole numbers (undefined when empty). */
function NumInput({ value, placeholder, onCommit, max = 240, changed }: { value: number | undefined; placeholder?: string; onCommit: (n: number | undefined) => void; max?: number; changed?: boolean }) {
  const show = value == null ? '' : String(value);
  const [text, setText] = useState(show);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(show);
  }, [show]);
  return (
    <input
      class={`num ${changed ? 'changed' : ''}`}
      type="text"
      inputMode="numeric"
      value={text}
      placeholder={placeholder}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        setText(show);
      }}
      onInput={(e) => {
        const t = val(e).replace(/\D/g, '').slice(0, 3);
        setText(t);
        onCommit(t === '' ? undefined : Math.min(max, parseInt(t, 10)));
      }}
    />
  );
}

function ListField({ sid, k, value, placeholder, hint, onSet }: { sid: string; k: string; value: string[]; placeholder: string; hint?: string; onSet: (patch: Record<string, string[]>) => void }) {
  const song = isSongKey(k);
  const clean = () => {
    if (!song) return onSet({ [k]: value.map((s) => s.trim()).filter(Boolean) });
    const r = parseSongs(value.join('\n'));
    // a whole worship-team message pasted into 찬양 1 is split at its "-- 광고 --" line
    if (sid === '4' && k === '찬양1' && r.hasDivider) onSet({ 찬양1: r.before, 찬양2: r.after });
    else onSet({ [k]: [...r.before, ...r.after] });
  };
  return (
    <Field label={LIST_LABEL[k] ?? k} hint={hint} wide>
      <textarea
        rows={Math.max(song ? 3 : 1, Math.min(10, value.length + (song ? 1 : 0)))}
        value={value.join('\n')}
        placeholder={placeholder}
        spellcheck={false}
        onInput={(e) => onSet({ [k]: val(e).split('\n') })}
        onBlur={clean}
      />
    </Field>
  );
}

interface Props {
  sid: string;
  input: ServiceInput;
  sheet: Sheet;
  onChange: (fn: Mut<ServiceInput>) => void;
  onCopyStaff: (from: string) => void;
}

export function ServiceForm({ sid, input, sheet, onChange, onCopyStaff }: Props) {
  const svc = rules.services[sid];
  const fields = useMemo(() => fieldsFor(svc), [svc]);
  const shown = new Set([...fields.lists.keys(), ...fields.scalars.keys()]);
  const setPerson = (k: string, v: string) =>
    onChange((s) => {
      if (v.trim()) s.people[k] = v;
      else delete s.people[k];
    });
  const setLists = (patch: Record<string, string[]>) =>
    onChange((s) => {
      for (const [k, v] of Object.entries(patch)) {
        if (v.some((x) => x.trim())) s.lists[k] = v;
        else delete s.lists[k];
      }
    });
  const setValue = (k: string, v: string) =>
    onChange((s) => {
      if (v.trim()) s.values[k] = v;
      else delete s.values[k];
    });

  return (
    <div class="form">
      <section>
        <label class="check include">
          <input type="checkbox" checked={input.include} onChange={(e) => onChange((s) => void (s.include = e.currentTarget.checked))} />
          이번 주 {svc.label} 큐시트 만들기
        </label>
        <div class="grid">
          <Field label="시작 시간" hint={input.start && input.start !== svc.start ? `가이드라인 ${svc.start}` : undefined}>
            <input
              type="time"
              class={input.start && input.start !== svc.start ? 'changed' : ''}
              value={input.start ?? svc.start}
              onInput={(e) => {
                const v = val(e);
                onChange((s) => {
                  if (!v || v === svc.start) delete s.start;
                  else s.start = v;
                });
              }}
            />
          </Field>
          <Field label="보컬 Mic 수">
            <NumInput value={input.vocals} placeholder={String(svc.defaults.vocals)} max={20} onCommit={(n) => onChange((s) => void (n == null ? delete s.vocals : (s.vocals = n)))} />
          </Field>
          <Field label="인도자 Mic 수">
            <NumInput value={input.leaders} placeholder={String(svc.defaults.leaders)} max={5} onCommit={(n) => onChange((s) => void (n == null ? delete s.leaders : (s.leaders = n)))} />
          </Field>
        </div>
      </section>

      <section>
        <h3>출연</h3>
        <div class="grid">
          {svc.cast.map(([k, label, optional]) => (
            <Field key={k} label={optional ? `${label} (없으면 비움)` : label}>
              <input value={input.people[k] ?? ''} placeholder={PEOPLE_HINT[k] ?? ''} onInput={(e) => setPerson(k, val(e))} />
            </Field>
          ))}
        </div>
      </section>

      <section>
        <h3>
          스태프
          <select
            class="mini"
            value=""
            onChange={(e) => {
              const from = val(e);
              e.currentTarget.value = '';
              if (from) onCopyStaff(from);
            }}
          >
            <option value="">다른 예배에서 복사…</option>
            {SIDS.filter((x) => x !== sid).map((x) => (
              <option key={x} value={x}>{rules.services[x].label}</option>
            ))}
          </select>
        </h3>
        <div class="grid">
          {rules.staffOrder.map((k) => (
            <Field key={k} label={k}>
              <input value={input.people[k] ?? ''} onInput={(e) => setPerson(k, val(e))} />
            </Field>
          ))}
        </div>
      </section>

      <section>
        <h3>찬양 · 말씀</h3>
        {[...fields.lists].map(([k, def]) => (
          <ListField
            key={k}
            sid={sid}
            k={k}
            value={input.lists[k] ?? []}
            placeholder={def.join('\n')}
            hint={k === '찬양1' ? '찬양팀 메시지를 통째로 붙여넣어도 됩니다 — 링크·번호를 지우고 “-- 광고 --” 뒤의 곡은 찬양 2로 옮깁니다' : isSongKey(k) ? '한 줄에 한 곡 (붙여넣은 링크·번호는 자동 정리)' : undefined}
            onSet={setLists}
          />
        ))}
        <div class="grid">
          {[...fields.scalars].map(([k, def]) => (
            <Field key={k} label={k}>
              <input value={input.values[k] ?? ''} placeholder={def} onInput={(e) => setValue(k, val(e))} />
            </Field>
          ))}
        </div>
      </section>

      <Specials sid={sid} input={input} sheet={sheet} shown={shown} onChange={onChange} setLists={setLists} setValue={setValue} />
      <OrderEditor sid={sid} input={input} sheet={sheet} onChange={onChange} />
      <EditsEditor sid={sid} input={input} onChange={onChange} />
    </div>
  );
}

function Specials({ sid, input, sheet, shown, onChange, setLists, setValue }: {
  sid: string; input: ServiceInput; sheet: Sheet; shown: Set<string>; onChange: (fn: Mut<ServiceInput>) => void;
  setLists: (p: Record<string, string[]>) => void; setValue: (k: string, v: string) => void;
}) {
  const svc = rules.services[sid];
  return (
    <section>
      <h3>특별순서</h3>
      <p class="hint">자동: 가이드라인대로 (성찬식 = 첫째 주일, 비전헌금 = 둘째 주일, 나머지는 순서에 적었을 때만)</p>
      {svc.specials.map((sp) => {
        const st = sheet.specials.find((x) => x.id === sp.id);
        const on = !!st?.enabled;
        const explicit = input.specials[sp.id];
        const mode = explicit === true ? 'on' : explicit === false ? 'off' : 'auto';
        const why = !on ? '' : explicit === true ? '' : st?.auto ? (sp.auto === 'week1' ? '첫째 주일' : '둘째 주일') : '순서에 있음';
        const params = sp.params.filter((p) => !shown.has(p.key));
        const sharedParams = sp.params.filter((p) => shown.has(p.key));
        return (
          <div key={sp.id} class={`special ${on ? 'on' : ''}`}>
            <div class="special-head">
              <span class="special-name">{sp.label}</span>
              {sp.source.kind === 'supplement' && (
                <span class="chip supp" title={sp.source.note ?? sp.source.ref}>보완 규칙</span>
              )}
              <span class={`state ${on ? 'on' : ''}`}>{on ? `포함${why ? ` (${why})` : ''}` : '없음'}</span>
              <span class="seg">
                {(
                  [
                    ['auto', '자동'],
                    ['on', '포함'],
                    ['off', '제외'],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    class={mode === m ? 'active' : ''}
                    onClick={() =>
                      onChange((s) => {
                        if (m === 'auto') delete s.specials[sp.id];
                        else s.specials[sp.id] = m === 'on';
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </span>
            </div>
            {on && sp.source.kind === 'supplement' && sp.source.note && <div class="hint">가이드라인 보완: {sp.source.note}</div>}
            {on && sp.notes.map((n, i) => <div key={i} class="hint warn">⚠︎ {n}</div>)}
            {on && params.length > 0 && (
              <div class="grid">
                {params.map((p) =>
                  p.list ? (
                    <ListField key={p.key} sid={sid} k={p.key} value={input.lists[p.key] ?? []} placeholder={p.label} onSet={setLists} />
                  ) : (
                    <Field key={p.key} label={p.label}>
                      <input value={input.values[p.key] ?? ''} onInput={(e) => setValue(p.key, val(e))} />
                    </Field>
                  ),
                )}
              </div>
            )}
            {on && sharedParams.length > 0 && <div class="hint">{sharedParams.map((p) => LIST_LABEL[p.key] ?? p.label).join(', ')}: 위 “찬양 · 말씀”에 입력</div>}
          </div>
        );
      })}
    </section>
  );
}

function OrderEditor({ sid, input, sheet, onChange }: { sid: string; input: ServiceInput; sheet: Sheet; onChange: (fn: Mut<ServiceInput>) => void }) {
  const names = useMemo(() => rowNamesFor(rules, sid), [sid]);
  const custom = !!input.order?.length;
  const changed = (r: SheetRow) => r.ruleDur != null && r.dur !== r.ruleDur;

  if (!custom) {
    const setDur = (r: SheetRow, n: number | undefined) =>
      onChange((s) => {
        const d = { ...(s.durations ?? {}) };
        delete d[r.key];
        delete d[r.name];
        if (n != null && n !== r.ruleDur) d[r.name] = n;
        if (Object.keys(d).length) s.durations = d;
        else delete s.durations;
      });
    const toCustom = () =>
      onChange((s) => {
        s.order = sheet.rows.map((r) => (changed(r) || r.ruleDur == null ? { ref: r.name, dur: r.dur } : { ref: r.name }));
        delete s.durations;
      });
    return (
      <section>
        <h3>
          순서 · 시간 <span class="chip">가이드라인 순서</span>
        </h3>
        <table class="order">
          <thead>
            <tr><th>시작</th><th>순서</th><th>분</th><th /></tr>
          </thead>
          <tbody>
            {sheet.rows.map((r) => (
              <tr key={r.key}>
                <td class="mono">{r.start}</td>
                <td>
                  {r.name}
                  {r.source.kind === 'supplement' && <span class="chip supp">보완</span>}
                </td>
                <td>
                  <NumInput value={r.dur} placeholder={String(r.ruleDur ?? '')} changed={changed(r)} onCommit={(n) => setDur(r, n)} />
                </td>
                <td class="muted small">{changed(r) ? `가이드라인 ${r.ruleDur}’` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div class="actions">
          <button onClick={toCustom}>순서 직접 편집…</button>
          <span class="muted">끝 {sheet.end}</span>
        </div>
        <p class="hint">이번 주 순서가 가이드라인과 다르면 “순서 직접 편집”을 누르세요. 특별순서(영상, 강사소개 등)를 순서에 적으면 자동으로 포함됩니다.</p>
      </section>
    );
  }

  const order = input.order!;
  const listId = `rownames-${sid}`;
  const ruleDur = (ref: string) => {
    const n = norm(ref);
    const r = sheet.rows.find((x) => norm(x.name) === n);
    return r?.ruleDur != null ? String(r.ruleDur) : '';
  };
  const edit = (fn: (o: NonNullable<ServiceInput['order']>) => void) =>
    onChange((s) => {
      fn(s.order!);
    });
  const reset = async () => {
    if (await confirmBox('직접 편집한 순서와 시간을 지우고 가이드라인 순서로 되돌릴까요?', '되돌리기'))
      onChange((s) => {
        delete s.order;
        delete s.durations;
      });
  };

  return (
    <section>
      <h3>
        순서 · 시간 <span class="chip user">직접 편집</span>
      </h3>
      <datalist id={listId}>
        {names.map((n) => <option key={n} value={n} />)}
      </datalist>
      <table class="order">
        <thead>
          <tr><th>#</th><th>순서 이름</th><th>분</th><th /></tr>
        </thead>
        <tbody>
          {order.map((e, i) => {
            const known = !e.ref.trim() || isName(sid, e.ref);
            return (
              <tr key={i}>
                <td class="muted">{i + 1}</td>
                <td>
                  <input
                    list={listId}
                    class={known ? '' : 'custom'}
                    value={e.ref}
                    placeholder="목록에서 고르거나 직접 입력"
                    onInput={(ev) => {
                      const v = val(ev);
                      edit((o) => void (o[i] = { ...o[i], ref: v }));
                    }}
                  />
                  {!known && <div class="hint warn">가이드라인에 없는 순서 — 칸 내용은 아래 “고급”에서 입력</div>}
                </td>
                <td>
                  <NumInput
                    value={e.dur}
                    placeholder={ruleDur(e.ref)}
                    onCommit={(n) =>
                      edit((o) => {
                        o[i] = n == null ? { ref: o[i].ref } : { ref: o[i].ref, dur: n };
                      })
                    }
                  />
                </td>
                <td class="btns">
                  <button title="위로" disabled={i === 0} onClick={() => edit((o) => void o.splice(i - 1, 2, o[i], o[i - 1]))}>↑</button>
                  <button title="아래로" disabled={i === order.length - 1} onClick={() => edit((o) => void o.splice(i, 2, o[i + 1], o[i]))}>↓</button>
                  <button title="삭제" onClick={() => edit((o) => void o.splice(i, 1))}>✕</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div class="actions">
        <button onClick={() => edit((o) => void o.push({ ref: '' }))}>+ 순서 추가</button>
        <button onClick={reset}>가이드라인 순서로 되돌리기</button>
        <span class="muted">끝 {sheet.end}</span>
      </div>
      <p class="hint">빈 칸의 분은 가이드라인 시간입니다. 가이드라인과 다른 순서·시간은 미리보기에 경고로 표시됩니다.</p>
    </section>
  );
}

function EditsEditor({ sid, input, onChange }: { sid: string; input: ServiceInput; onChange: (fn: Mut<ServiceInput>) => void }) {
  const ext = JSON.stringify([input.roles ?? [], input.edits ?? []]);
  const committed = useRef(ext);
  const [text, setText] = useState(() => editLines(input).join('\n'));
  const [warns, setWarns] = useState<string[]>([]);
  const count = (input.roles?.length ?? 0) + (input.edits?.length ?? 0);
  const [open] = useState(count > 0);
  useEffect(() => {
    // the input changed elsewhere (text import, file open): show it
    if (ext !== committed.current) {
      committed.current = ext;
      setText(editLines(input).join('\n'));
      setWarns([]);
    }
  }, [ext]);
  const commit = () => {
    const r = parseEdits(sid, text, isName);
    committed.current = JSON.stringify([r.roles, r.edits]);
    setWarns(r.warnings);
    onChange((s) => {
      if (r.roles.length) s.roles = r.roles;
      else delete s.roles;
      if (r.edits.length) s.edits = r.edits;
      else delete s.edits;
    });
  };
  return (
    <details class="section" open={open}>
      <summary>
        <h3>
          고급: 담당 변경 · 칸 직접 수정 {count > 0 && <span class="badge warn">{count}</span>}
        </h3>
      </summary>
      <p class="hint">가이드라인과 다르게 적어야 할 때만 씁니다. 바뀐 칸은 미리보기에 표시되고 경고가 남습니다.</p>
      <textarea class="code" rows={7} value={text} placeholder={EDIT_EXAMPLE} spellcheck={false} onInput={(e) => setText(val(e))} onBlur={commit} />
      {warns.map((w, i) => (
        <div key={i} class="hint warn">⚠︎ {w}</div>
      ))}
      <p class="hint">형식: “담당변경:” 아래 “순서: 원래 -&gt; 바꿀 역할”, “추가:”/“변경:” 아래 “순서 | 칸 | 내용”. 칸: 내용, 담당, 음향, 화면, 조명, 입-출, 무대, 세부사항</p>
    </details>
  );
}
