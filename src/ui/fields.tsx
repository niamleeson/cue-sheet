import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { fieldShow } from '../core/doc';
import type { FieldKind } from '../core/doc';
import { takeShared, writeField } from '../core/ops';
import { parseSongs } from '../core/parse';
import type { CueDoc } from '../core/types';
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

interface DocFieldProps {
  doc: CueDoc;
  sid: string;
  kind: FieldKind;
  k: string;
  label?: string;
  placeholder?: string;
  hint?: ComponentChildren;
  change: Change;
  /** 4부 찬양 1: a pasted worship-team message is split at its "-- 광고 --" line into 찬양 1 and 찬양 2 */
  splitSongs?: boolean;
}

/**
 * One typed field of the document (a person, a value or a list). What is typed here is used by every other service
 * that has nothing typed; there it shows as the placeholder. Typing over the placeholder starts this service's own
 * value from scratch; 수정 starts it from the placeholder.
 */
export function DocField({ doc, sid, kind, k, label = k, placeholder, hint, change, splitSongs }: DocFieldProps) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const focusEnd = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!focusEnd.current || !el) return;
    focusEnd.current = false;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });
  const { text, from } = fieldShow(rules, doc, sid, kind, k);
  const tip = from && `${svcLabel(from.sid)}에 입력한 값입니다 — 그대로 두면 ${svcLabel(sid)}에도 들어가고, 입력하면 ${svcLabel(sid)}만 바뀝니다.`;
  const take = from && (
    <button
      type="button"
      class="take"
      title={`${svcLabel(from.sid)}에 입력한 값을 ${svcLabel(sid)} 칸에 넣고 고칩니다`}
      onClick={() => {
        focusEnd.current = true;
        change((d) => takeShared(rules, d, sid, kind, k));
      }}
    >
      수정
    </button>
  );
  if (kind !== 'lists') {
    return (
      <Field label={label} hint={hint} extra={take}>
        <input
          ref={ref}
          class={from ? 'inherit' : undefined}
          value={(text as string | undefined) ?? ''}
          placeholder={from ? (from.value as string) : placeholder}
          title={tip}
          onInput={(e) => { const x = val(e); change((d) => writeField(rules, d, sid, kind, k, x)); }}
        />
      </Field>
    );
  }
  const items = (text as string[] | undefined) ?? [];
  const inherited = (from?.value as string[] | undefined) ?? [];
  const song = isSongKey(k);
  // only what is typed here is tidied: the placeholder stays a placeholder
  const clean = () =>
    change((d) => {
      const cur = fieldShow(rules, d, sid, 'lists', k).text as string[] | undefined;
      if (!cur) return;
      if (!song) {
        const next = cur.map((s) => s.trim()).filter(Boolean);
        if (next.join('\n') !== cur.join('\n')) writeField(rules, d, sid, 'lists', k, next);
        return;
      }
      const r = parseSongs(cur.join('\n'));
      if (splitSongs && r.hasDivider) {
        writeField(rules, d, sid, 'lists', k, r.before);
        writeField(rules, d, sid, 'lists', '찬양2', r.after);
      } else {
        const next = [...r.before, ...r.after];
        if (next.join('\n') !== cur.join('\n')) writeField(rules, d, sid, 'lists', k, next);
      }
    });
  return (
    <Field label={label} hint={hint} extra={take} wide>
      <textarea
        ref={ref}
        class={from ? 'inherit' : undefined}
        rows={Math.max(song ? 2 : 1, Math.min(10, (from ? inherited.length : items.length) + (song ? 1 : 0)))}
        value={items.join('\n')}
        placeholder={from ? inherited.join('\n') : placeholder}
        title={tip}
        spellcheck={false}
        onInput={(e) => { const x = val(e).split('\n'); change((d) => writeField(rules, d, sid, 'lists', k, x)); }}
        onBlur={clean}
      />
    </Field>
  );
}
