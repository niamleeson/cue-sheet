import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { fieldMode, fieldValue } from '../core/doc';
import type { FieldKind } from '../core/doc';
import { differingServices, makeOwn, makeShared, writeField } from '../core/ops';
import { parseSongs } from '../core/parse';
import type { CueDoc } from '../core/types';
import { confirmBox } from './platform';
import { rules } from './store';

/** A change to the open document (the function mutates a copy). */
export type Change = (fn: (d: CueDoc) => void) => void;

export const val = (e: Event) => (e.currentTarget as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
export const svcLabel = (sid: string) => rules.services[sid]?.label ?? sid;

export const LIST_LABEL: Record<string, string> = {
  찬양: '찬양', 찬양1: '찬양 1 (광고 전)', 찬양2: '찬양 2 (광고 후)', 본문: '성경 본문', 설교제목: '설교 제목',
  봉헌찬양: '봉헌 찬양', 축도찬양: '축도 찬양', 마무리찬양: '마무리 찬양', 성가대찬양: '성가대 찬양', 선교지: '선교지', 과정: '수료 과정',
  설교후찬양: '설교 후 찬양', 특순곡: '특순 곡', 교역자특순곡: '교역자 특순 곡', 축복송: '축복송',
};
export const PEOPLE_HINT: Record<string, string> = { 사회: 'OOO 목사', 설교: 'OOO 목사', 인도: 'OOO 전도사', 나래이션: 'OOO' };
export const isSongKey = (k: string) => /찬양|곡$|송$/.test(k);

export function Field({ label, hint, extra, children, wide }: { label: string; hint?: ComponentChildren; extra?: ComponentChildren; children: ComponentChildren; wide?: boolean }) {
  return (
    <div class={`field ${wide ? 'wide' : ''}`}>
      <div class="field-top">
        <span class="field-label">{label}</span>
        {extra}
      </div>
      {children}
      {hint && <span class="hint">{hint}</span>}
    </div>
  );
}

/** Number box that can be cleared while typing; commits whole numbers (undefined when empty). */
export function NumInput({ value, placeholder, onCommit, max = 240, changed, title }: { value: number | undefined; placeholder?: string; onCommit: (n: number | undefined) => void; max?: number; changed?: boolean; title?: string }) {
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
      title={title}
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

/** 공통 / 이 예배만 switch of one field (only when the document has more than one service). */
function ModeChip({ doc, sid, kind, k, label, services, change }: { doc: CueDoc; sid: string; kind: FieldKind; k: string; label: string; services: string[]; change: Change }) {
  if (services.length < 2) return null;
  const mode = fieldMode(doc, sid, kind, k);
  const others = services.filter((s) => s !== sid).map(svcLabel).join(', ');
  const toggle = async () => {
    if (mode === 'shared') return change((d) => makeOwn(d, sid, kind, k));
    const diff = differingServices(doc, sid, kind, k);
    if (diff.length && !(await confirmBox(`${label}을(를) 공통으로 바꾸면 ${diff.map(svcLabel).join(', ')}의 ${label}도 지금 ${svcLabel(sid)} 값으로 바뀝니다.`, '공통으로'))) return;
    change((d) => makeShared(d, sid, kind, k));
  };
  return (
    <button
      type="button"
      class={`mode ${mode}`}
      title={mode === 'shared' ? `공통: ${others}에도 같은 값이 들어갑니다 — 누르면 이 예배만 따로 입력` : `이 예배만 따로 입력합니다 — 누르면 ${others}와(과) 공통`}
      onClick={toggle}
    >
      {mode === 'shared' ? '공통' : '이 예배만'}
    </button>
  );
}

interface DocFieldProps {
  doc: CueDoc;
  sid: string;
  kind: FieldKind;
  k: string;
  label?: string;
  placeholder?: string;
  hint?: ComponentChildren;
  services: string[];
  change: Change;
  /** 4부 찬양 1: a pasted worship-team message is split at its "-- 광고 --" line into 찬양 1 and 찬양 2 */
  splitSongs?: boolean;
}

/** One typed field of the document (a person, a value or a list), written where it lives (공통 or 이 예배만). */
export function DocField({ doc, sid, kind, k, label = k, placeholder, hint, services, change, splitSongs }: DocFieldProps) {
  const chip = <ModeChip doc={doc} sid={sid} kind={kind} k={k} label={label} services={services} change={change} />;
  if (kind !== 'lists') {
    const v = (fieldValue(doc, sid, kind, k) as string | undefined) ?? '';
    return (
      <Field label={label} hint={hint} extra={chip}>
        <input value={v} placeholder={placeholder} onInput={(e) => { const x = val(e); change((d) => writeField(d, sid, kind, k, x)); }} />
      </Field>
    );
  }
  const items = (fieldValue(doc, sid, 'lists', k) as string[] | undefined) ?? [];
  const song = isSongKey(k);
  const clean = () =>
    change((d) => {
      const cur = (fieldValue(d, sid, 'lists', k) as string[] | undefined) ?? [];
      if (!song) {
        const next = cur.map((s) => s.trim()).filter(Boolean);
        if (next.join('\n') !== cur.join('\n')) writeField(d, sid, 'lists', k, next);
        return;
      }
      const r = parseSongs(cur.join('\n'));
      if (splitSongs && r.hasDivider) {
        writeField(d, sid, 'lists', k, r.before);
        writeField(d, sid, 'lists', '찬양2', r.after);
      } else {
        const next = [...r.before, ...r.after];
        if (next.join('\n') !== cur.join('\n')) writeField(d, sid, 'lists', k, next);
      }
    });
  return (
    <Field label={label} hint={hint} extra={chip} wide>
      <textarea
        rows={Math.max(song ? 2 : 1, Math.min(10, items.length + (song ? 1 : 0)))}
        value={items.join('\n')}
        placeholder={placeholder}
        spellcheck={false}
        onInput={(e) => { const x = val(e).split('\n'); change((d) => writeField(d, sid, 'lists', k, x)); }}
        onBlur={clean}
      />
    </Field>
  );
}
