import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { cellEdits, cellLines, cellText, linkedEdits, scopeChoices } from '../core/cellsave';
import { EDIT_COL_LABELS } from '../core/engine';
import type { PageRender } from '../core/render';
import { cellTargets } from '../core/targets';
import type { CellTarget } from '../core/targets';
import type { CueDoc, EditCol, Sheet, SheetRow } from '../core/types';
import { svcLabel } from './fields';
import { isWindows } from './platform';
import { rowLabel } from './ServiceForm';
import { ONE_PAGE } from './store';

export interface FitInfo {
  pct: number;
  warnings: string[];
  error?: string;
  /** the finished page, laid out the way Word lays it out */
  page?: PageRender;
  /** why the page could not be drawn */
  pageError?: string;
  /** the sheet the page was drawn from (the clickable cells are matched against it) */
  sheet?: Sheet;
}

/** the cell typed in: of which document and service, so it never lands on another one */
export interface OpenCell { doc: string; sid: string; row: string; col: EditCol }

interface Props {
  doc: CueDoc;
  sid: string;
  sheet: Sheet;
  /** every service of the document (다른 예배에도 적용) */
  sheets: Sheet[];
  fit?: FitInfo;
  /** false while Word's 맑은 고딕 is not available: glyphs are drawn with a look-alike font */
  wordFont: boolean;
  showRules: boolean;
  onShowRules: (v: boolean) => void;
  highlight: string | null;
  onHighlight: (key: string | null) => void;
  cell: OpenCell | null;
  onCell: (c: OpenCell | null) => void;
  /** saves the typed cell; false when it could not be saved (the editor stays open) */
  onSave: (c: OpenCell, text: string, scope: string[]) => boolean;
  onReset: (c: OpenCell) => void;
  /** set while a cell is open: saves it (if changed) and closes it; false when it could not be saved (it stays open) */
  commitRef: { current: (() => boolean) | null };
}

type Zoom = 'fit' | '1' | '1.5';
const ZOOMS: [Zoom, string][] = [['fit', '맞춤'], ['1', '100%'], ['1.5', '150%']];
const PX_PER_PT = 96 / 72;
/** width of the notes column beside the page (px) */
const GUTTER = 168;
const NOTE_H = 18;
const EDITOR_W = 340;
const SAVE_KEY = isWindows ? 'Ctrl+Enter' : '⌘↵';

interface Note { cls: 'user' | 'supp' | 'flag'; text: string }
const notesOf = (r: SheetRow): Note[] => [
  ...(r.source.kind === 'user' ? [{ cls: 'user' as const, text: '직접 추가' }] : []),
  ...r.flags.filter((f) => f !== '가이드라인에 없는 순서').map((f) => ({ cls: f.startsWith('보완') ? ('supp' as const) : ('flag' as const), text: f })),
];
const markOf = (r: SheetRow) => (r.source.kind === 'user' ? 'user' : r.source.kind === 'supplement' ? 'supp' : r.flags.length ? 'flag' : null);
const cellKey = (row: string, col: EditCol) => `${row}|${col}`;

function FitGauge({ fit, onePage }: { fit?: FitInfo; onePage: boolean }) {
  if (!fit) return <span class="gauge muted">{onePage ? '한 페이지 계산 중…' : '쪽수 계산 중…'}</span>;
  if (fit.error) return <span class="gauge bad" title={fit.error}>서식 오류: {fit.error}</span>;
  if (!onePage) {
    return (
      <span class="gauge muted" title="Word와 같은 방식으로 계산한 표 높이 / 한 페이지 높이 (행사 큐시트는 여러 쪽이어도 됩니다)">
        약 {Math.max(1, Math.ceil(fit.pct / 100))}쪽 ({fit.pct}%)
      </span>
    );
  }
  const cls = fit.pct > 100 ? 'bad' : fit.pct > 92 ? 'tight' : 'good';
  const text = fit.pct > 100 ? `한 페이지 초과 예상 (${fit.pct}%)` : `한 페이지 사용 ${fit.pct}%`;
  return (
    <span class={`gauge ${cls}`} title="Word와 같은 방식으로 계산한 표 높이 / 페이지에 남은 높이">
      <span class="bar"><span style={{ width: `${Math.min(100, fit.pct)}%` }} /></span>
      {text}
    </span>
  );
}

interface EditorProps {
  doc: CueDoc;
  sid: string;
  sheet: Sheet;
  sheets: Sheet[];
  cell: OpenCell;
  target?: CellTarget;
  s: number;
  pageW: number;
  multi: boolean;
  onSave: Props['onSave'];
  onReset: Props['onReset'];
  onClose: () => void;
  commitRef: Props['commitRef'];
  onHeight: (bottom: number) => void;
}

const HINT: Partial<Record<EditCol, string>> = {
  time: '시작 시각이나 분(예: 5’)을 고치면 순서 시간에 반영됩니다.',
  staff: '이름을 고치면 스태프 입력에 저장됩니다.',
  cast: '이름을 고치면 출연 입력에 저장됩니다.',
};

/** The typed cell: opened under the cell, saved with ⌘↵ / Ctrl+Enter or by clicking elsewhere, Esc to cancel. */
function CellEditor({ doc, sid, sheet, sheets, cell, target, s, pageW, multi, onSave, onReset, onClose, commitRef, onHeight }: EditorProps) {
  const initial = useMemo(() => cellText(cellLines(sheet, cell.row, cell.col)), []);
  const choices = useMemo(() => scopeChoices(sheets, sid, cell.row, cell.col), []);
  const [text, setText] = useState(initial);
  // the change also goes to the services where the cell reads the same now (they can be unticked)
  const [scope, setScope] = useState<string[]>(() => choices.filter((c) => c.same).map((c) => c.sid));
  const box = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const edited = cellEdits(doc, sid, cell.row, cell.col).length > 0;
  // changed with a 담당 change in another cell of the row (its Mic, its 세부사항)
  const linked = !edited && linkedEdits(doc, sid, cell.row, cell.col).length > 0;
  const dirty = text !== initial || scope.some((x) => !choices.find((c) => c.sid === x)?.same);

  const latest = useRef({ text, scope, dirty });
  latest.current = { text, scope, dirty };
  const commit = (): boolean => {
    const l = latest.current;
    if (!l.dirty) {
      onClose();
      return true;
    }
    return onSave(cell, l.text, l.scope);
  };

  useEffect(() => {
    commitRef.current = commit;
    return () => {
      if (commitRef.current === commit) commitRef.current = null;
    };
  });
  useEffect(() => {
    const el = area.current;
    if (el) {
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    }
    box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    // a click anywhere else saves the cell (like a spreadsheet); the scroll bar of the pane does not
    const swallow = (e: Event) => {
      if (e.type === 'click' && box.current?.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || box.current?.contains(t) || t.classList?.contains('pane') || t.closest?.('.modal-back')) return;
      const save = commitRef.current;
      if (!save || save()) return;
      // not saved: the cell stays open and the click that would have left it does nothing
      swallow(e);
      document.addEventListener('click', swallow, true);
      document.addEventListener('pointerup', () => setTimeout(() => {
        document.removeEventListener('click', swallow, true);
        area.current?.focus({ preventScroll: true });
      }), { capture: true, once: true });
    };
    document.addEventListener('pointerdown', down, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('click', swallow, true);
    };
  }, []);

  const width = Math.min(pageW, Math.max(EDITOR_W, (target?.w ?? 0) * s));
  const left = Math.min(Math.max(0, (target?.x ?? 0) * s), Math.max(0, pageW - width));
  const top = target ? (target.y + target.h) * s + 4 : 8;
  useLayoutEffect(() => onHeight(top + (box.current?.offsetHeight ?? 0) + 8));
  const rows = Math.max(3, Math.min(14, text.split('\n').length + 1));

  return (
    <div class="cell-editor" ref={box} style={{ left: `${left}px`, top: `${top}px`, width: `${width}px` }}>
      <div class="ce-head">
        <b>{rowLabel(doc, sid, sheet, cell.row)}</b>
        <span class="muted">· {EDIT_COL_LABELS[cell.col]}</span>
        {multi && <span class="chip">{svcLabel(sid)}</span>}
        {edited && <span class="chip user">고친 칸</span>}
        {linked && <span class="chip user" title="같은 줄의 담당을 바꾸면서 함께 바뀐 칸">담당 변경으로 바뀐 칸</span>}
      </div>
      <textarea
        ref={area}
        value={text}
        rows={rows}
        spellcheck={false}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.isComposing) return;
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape' && e.keyCode !== 229) {
            // (229: WebKit's Esc that only ends the Korean input's composing)
            e.preventDefault();
            onClose();
          }
        }}
      />
      <div class="hint">{HINT[cell.col] ?? '한 줄에 하나씩 적으세요. 저장하면 시간·Mic·기호가 큐시트 형식에 맞게 정리됩니다.'}</div>
      {choices.length > 0 && (
        <div class="ce-scope">
          <span class="field-label">다른 예배에도 적용</span>
          {choices.map((c) => (
            <label key={c.sid} class="check" title={c.same ? '지금 이 칸과 내용이 같습니다' : '지금은 이 칸과 내용이 다릅니다 — 고르면 이 내용으로 바뀝니다'}>
              <input type="checkbox" checked={scope.includes(c.sid)} onChange={(e) => { const on = e.currentTarget.checked; setScope((p) => (on ? [...p, c.sid] : p.filter((x) => x !== c.sid))); }} />
              {c.label}
              {!c.same && <span class="muted small"> (지금 내용 다름)</span>}
            </label>
          ))}
        </div>
      )}
      <div class="ce-actions">
        {(edited || linked) && (
          <button
            class="ghost"
            title={edited ? '이 칸에 직접 고친 내용을 지우고 가이드라인·입력 내용으로' : '이 칸만 원래대로 (담당 변경은 그대로)'}
            onClick={() => onReset(cell)}
          >
            ↺ 원래대로
          </button>
        )}
        <span class="muted small">{SAVE_KEY} 저장 · Esc 취소</span>
        <button onClick={onClose}>취소</button>
        <button class="primary" onClick={commit}>저장</button>
      </div>
    </div>
  );
}

interface DocProps extends Omit<Props, 'fit' | 'wordFont' | 'onShowRules'> {
  page: PageRender;
  /** the sheet the page was drawn from */
  drawn: Sheet;
  zoom: Zoom;
}

/** The page exactly as the DOCX will print, its cells clickable, with the guideline notes beside it. */
function DocView(p: DocProps) {
  const { page, drawn, zoom, showRules, highlight, onHighlight, doc, sid, cell, onCell } = p;
  const host = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  const [edBottom, setEdBottom] = useState(0);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => setAvail(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byKey = useMemo(() => new Map(drawn.rows.map((r) => [r.key, r])), [drawn]);
  const targets = useMemo(() => cellTargets(page, drawn), [page, drawn]);
  const edited = useMemo(() => {
    const set = new Set<string>();
    for (const e of doc.edits) {
      if (!e.services.includes(sid)) continue;
      set.add(cellKey(e.row, e.col));
      for (const a of e.also ?? []) set.add(cellKey(e.row, a.col));
    }
    return set;
  }, [doc, sid]);
  const marked = showRules
    ? page.rows.flatMap((pr) => {
        const r = byKey.get(pr.key);
        const m = r && markOf(r);
        return r && m ? [{ pr, m, notes: notesOf(r) }] : [];
      })
    : [];
  const withNotes = marked.filter((x) => x.notes.length);
  // the notes column stays while 규칙 표시 is on, so the page keeps its size from service to service
  const gutter = showRules ? GUTTER : 0;
  const s = zoom === 'fit' ? Math.max(0.4, (avail - gutter) / page.width) : Number(zoom) * PX_PER_PT;
  const w = page.width * s;
  const h = page.viewHeight * s;

  useLayoutEffect(() => {
    art.current?.querySelectorAll('rect.hit').forEach((el) => el.classList.toggle('hl', el.getAttribute('data-row') === highlight));
  }, [page, highlight]);
  useEffect(() => {
    if (!cell) setEdBottom(0);
  }, [cell]);

  const toggle = (key: string) => onHighlight(highlight === key ? null : key);
  const open = (t: CellTarget) => {
    if (cell && cell.row === t.row && cell.col === t.col) return;
    onCell({ doc: doc.id, sid, row: t.row, col: t.col });
    if (byKey.has(t.row)) onHighlight(t.row);
  };

  // stack the notes so neighbouring rows' notes don't overlap
  let next = 0;
  const notes = withNotes.map((x) => {
    const top = Math.max(x.pr.y * s, next);
    next = top + x.notes.length * (NOTE_H + 2) + 4;
    return { ...x, top };
  });
  const target = cell ? targets.find((t) => t.row === cell.row && t.col === cell.col) : undefined;
  const name = (row: string) => (row === 'header' ? '머리글' : row === 'rehearsal' ? '리허설' : byKey.get(row)?.name ?? row);

  return (
    <div class="docview" ref={host}>
      {avail > 0 && (
        <div class="doc" style={{ width: `${w + gutter}px`, height: `${Math.max(h, next, cell ? edBottom : 0)}px` }}>
          <div class="page" style={{ width: `${w}px`, height: `${h}px` }}>
            <div class="art" ref={art} dangerouslySetInnerHTML={{ __html: page.svg }} />
            {marked.map(({ pr, m }) => (
              <div key={pr.key} class={`mark ${m}`} style={{ left: `${pr.x * s - 6}px`, top: `${pr.y * s}px`, height: `${pr.h * s}px` }} />
            ))}
            {targets.map((t) => {
              const k = cellKey(t.row, t.col);
              const on = cell && cell.row === t.row && cell.col === t.col;
              return (
                <div
                  key={k}
                  class={`cell-hit ${on ? 'on' : ''} ${showRules && edited.has(k) ? 'edited' : ''}`}
                  style={{ left: `${t.x * s}px`, top: `${t.y * s}px`, width: `${t.w * s}px`, height: `${t.h * s}px` }}
                  title={`${name(t.row)} · ${EDIT_COL_LABELS[t.col]}${edited.has(k) ? ' (고친 칸)' : ''} — 눌러서 고치기`}
                  onClick={() => open(t)}
                />
              );
            })}
            {page.bottom > page.height + 2 && (
              <div class="page-end-label" style={{ top: `${page.height * s}px` }}>
                ▲ 1쪽 끝 — 이 아래는 2쪽으로 넘어갑니다
              </div>
            )}
            {cell && (
              <CellEditor
                key={`${doc.id}|${sid}|${cell.row}|${cell.col}`}
                doc={doc}
                sid={sid}
                sheet={p.sheet}
                sheets={p.sheets}
                cell={cell}
                target={target}
                s={s}
                pageW={w}
                multi={p.sheets.length > 1}
                onSave={p.onSave}
                onReset={p.onReset}
                onClose={() => onCell(null)}
                commitRef={p.commitRef}
                onHeight={setEdBottom}
              />
            )}
          </div>
          {notes.map(({ pr, notes: ns, top }) => (
            <div key={pr.key} class={`notes ${highlight === pr.key ? 'hl' : ''}`} style={{ left: `${w + 8}px`, top: `${top}px`, width: `${gutter - 8}px` }} onClick={() => toggle(pr.key)}>
              {ns.map((n, i) => (
                <span key={i} class={`chip ${n.cls}`} title={n.text}>{n.text}</span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Preview(props: Props) {
  const { sheet, fit, wordFont, showRules, onShowRules, onHighlight } = props;
  const [zoom, setZoom] = useState<Zoom>(() => {
    const z = localStorage.getItem('cuesheet.zoom');
    return ZOOMS.some(([v]) => v === z) ? (z as Zoom) : 'fit';
  });
  useEffect(() => localStorage.setItem('cuesheet.zoom', zoom), [zoom]);

  const warns = sheet.warnings.filter((w) => w.level === 'warn');
  const infos = sheet.warnings.filter((w) => w.level === 'info');
  const go = (row?: string) => {
    if (!row) return;
    onHighlight(row);
    (document.getElementById(`card-${row}`) ?? document.getElementById(`row-${row}`))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const on = sheet.specials.filter((s) => s.enabled);

  return (
    <div class="preview">
      <div class="preview-bar">
        <FitGauge fit={fit} onePage={ONE_PAGE.has(sheet.serviceId)} />
        <span class="muted">
          {sheet.rows[0]?.start}–{sheet.end} · {sheet.rows.length}개 순서
        </span>
        {on.length > 0 && (
          <span class="muted">
            특별순서: {on.map((s) => s.label + (s.source.kind === 'supplement' ? '(보완)' : '')).join(', ')}
          </span>
        )}
        <label class="check small">
          <input type="checkbox" checked={showRules} onChange={(e) => onShowRules(e.currentTarget.checked)} /> 규칙 표시
        </label>
        <div class="seg zoom" role="group" aria-label="미리보기 크기">
          {ZOOMS.map(([z, label]) => (
            <button key={z} class={zoom === z ? 'active' : ''} onClick={() => setZoom(z)}>{label}</button>
          ))}
        </div>
      </div>
      <div class="muted small preview-tip">칸을 누르면 바로 고칠 수 있습니다 — 고친 내용은 저장되어 다음 큐시트에도 이어집니다.</div>

      {fit?.warnings.map((w, i) => (
        <div key={i} class="notice warn">⚠︎ {w}</div>
      ))}

      {(warns.length > 0 || infos.length > 0) && (
        <details class="warnings" open={warns.length > 0}>
          <summary>
            확인할 점 {warns.length > 0 && <span class="badge warn">경고 {warns.length}</span>}
            {infos.length > 0 && <span class="badge info">알림 {infos.length}</span>}
          </summary>
          <ul>
            {[...warns, ...(showRules ? infos : [])].map((w, i) => (
              <li key={i} class={`${w.level} ${w.row ? 'link' : ''}`} onClick={() => go(w.row)}>
                {w.level === 'warn' ? '⚠︎' : 'ℹ︎'} {w.text}
              </li>
            ))}
            {!showRules && infos.length > 0 && <li class="muted">알림 {infos.length}개는 “규칙 표시”를 켜면 보입니다</li>}
          </ul>
        </details>
      )}

      {fit?.page && fit.sheet ? (
        <DocView {...props} page={fit.page} drawn={fit.sheet} zoom={zoom} />
      ) : (
        <div class={`page-placeholder ${fit?.error || fit?.pageError ? 'bad' : ''}`}>
          {fit?.error ? `미리보기를 만들 수 없습니다 — ${fit.error}` : fit?.pageError ? `미리보기를 그릴 수 없습니다 — ${fit.pageError}` : '미리보기 만드는 중…'}
        </div>
      )}
      {fit?.page && !wordFont && (
        <div class="muted small font-note">Word의 맑은 고딕을 찾지 못해 비슷한 글꼴로 그렸습니다. 줄바꿈과 위치는 Word와 같습니다.</div>
      )}

      {sheet.prep.length > 0 && (
        <div class="prep">
          <h4>준비 사항 (큐시트에는 들어가지 않음)</h4>
          <ul>
            {sheet.prep.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
