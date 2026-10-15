import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { PageRender } from '../core/render';
import type { Sheet, SheetRow } from '../core/types';

export interface FitInfo {
  pct: number;
  warnings: string[];
  error?: string;
  /** the finished page, laid out the way Word lays it out */
  page?: PageRender;
  /** why the page could not be drawn */
  pageError?: string;
}

interface Props {
  sheet: Sheet;
  included: boolean;
  fit?: FitInfo;
  /** false while Word's 맑은 고딕 is not available: glyphs are drawn with a look-alike font */
  wordFont: boolean;
  showRules: boolean;
  onShowRules: (v: boolean) => void;
  highlight: string | null;
  onHighlight: (key: string | null) => void;
}

type Zoom = 'fit' | '1' | '1.5';
const ZOOMS: [Zoom, string][] = [['fit', '맞춤'], ['1', '100%'], ['1.5', '150%']];
const PX_PER_PT = 96 / 72;
/** width of the notes column beside the page (px) */
const GUTTER = 168;
const NOTE_H = 18;

interface Note { cls: 'user' | 'supp' | 'flag'; text: string }
const notesOf = (r: SheetRow): Note[] => [
  ...(r.source.kind === 'user' ? [{ cls: 'user' as const, text: '직접 추가' }] : []),
  ...r.flags.map((f) => ({ cls: f.startsWith('보완') ? ('supp' as const) : ('flag' as const), text: f })),
];
const markOf = (r: SheetRow) => (r.source.kind === 'user' ? 'user' : r.source.kind === 'supplement' ? 'supp' : r.flags.length ? 'flag' : null);

function FitGauge({ fit }: { fit?: FitInfo }) {
  if (!fit) return <span class="gauge muted">한 페이지 계산 중…</span>;
  if (fit.error) return <span class="gauge bad" title={fit.error}>서식 오류: {fit.error}</span>;
  const cls = fit.pct > 100 ? 'bad' : fit.pct > 92 ? 'tight' : 'good';
  const text = fit.pct > 100 ? `한 페이지 초과 예상 (${fit.pct}%)` : `한 페이지 사용 ${fit.pct}%`;
  return (
    <span class={`gauge ${cls}`} title="Word와 같은 방식으로 계산한 표 높이 / 페이지에 남은 높이">
      <span class="bar"><span style={{ width: `${Math.min(100, fit.pct)}%` }} /></span>
      {text}
    </span>
  );
}

interface DocProps {
  page: PageRender;
  sheet: Sheet;
  dim: boolean;
  zoom: Zoom;
  showRules: boolean;
  highlight: string | null;
  onHighlight: (key: string | null) => void;
}

/** The page exactly as the DOCX will print, with the guideline notes beside it. */
function DocView({ page, sheet, dim, zoom, showRules, highlight, onHighlight }: DocProps) {
  const host = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => setAvail(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byKey = useMemo(() => new Map(sheet.rows.map((r) => [r.key, r])), [sheet]);
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

  const toggle = (key: string) => onHighlight(highlight === key ? null : key);
  const pick = (e: MouseEvent) => {
    const key = (e.target as Element).closest?.('rect.hit')?.getAttribute('data-row');
    if (key) toggle(key);
  };

  // stack the notes so neighbouring rows' notes don't overlap
  let next = 0;
  const notes = withNotes.map((x) => {
    const top = Math.max(x.pr.y * s, next);
    next = top + x.notes.length * (NOTE_H + 2) + 4;
    return { ...x, top };
  });

  return (
    <div class="docview" ref={host}>
      {avail > 0 && (
        <div class="doc" style={{ width: `${w + gutter}px`, height: `${Math.max(h, next)}px` }}>
          <div class={`page ${dim ? 'dim' : ''}`} style={{ width: `${w}px`, height: `${h}px` }}>
            <div class="art" ref={art} onClick={pick} dangerouslySetInnerHTML={{ __html: page.svg }} />
            {marked.map(({ pr, m }) => (
              <div key={pr.key} class={`mark ${m}`} style={{ left: `${pr.x * s - 6}px`, top: `${pr.y * s}px`, height: `${pr.h * s}px` }} />
            ))}
            {page.bottom > page.height + 2 && (
              <div class="page-end-label" style={{ top: `${page.height * s}px` }}>
                ▲ 1쪽 끝 — 이 아래는 2쪽으로 넘어갑니다
              </div>
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

export function Preview({ sheet, included, fit, wordFont, showRules, onShowRules, highlight, onHighlight }: Props) {
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
    document.getElementById(`row-${row}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const on = sheet.specials.filter((s) => s.enabled);

  return (
    <div class="preview">
      <div class="preview-bar">
        <FitGauge fit={fit} />
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

      {!included && <div class="notice">이번 주에는 이 예배 큐시트를 만들지 않습니다 (입력 탭의 “만들기”가 꺼져 있음)</div>}
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

      {fit?.page ? (
        <DocView page={fit.page} sheet={sheet} dim={!included} zoom={zoom} showRules={showRules} highlight={highlight} onHighlight={onHighlight} />
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
