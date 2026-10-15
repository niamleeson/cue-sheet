import type { ComponentChildren } from 'preact';
import { useEffect, useErrorBoundary, useMemo, useState } from 'preact/hooks';
import './App.css';
import { buildSheet, emptyService, emptyWeek, sundayIndex } from './core/engine';
import { renderPage } from './core/render';
import type { PageRender } from './core/render';
import type { ServiceInput, Sheet, WeekInput } from './core/types';
import { alertBox, confirmBox, errorText, exportPdf, fileExists, inTauri, isMobile, joinPath, loadWordFont, openFile, pdfSupport, pickFolder, reveal, revealLabel, saveFile, writeBytes, writeErrorText } from './ui/platform';
import type { PdfSupport } from './ui/platform';
import { Preview } from './ui/Preview';
import type { FitInfo } from './ui/Preview';
import { ServiceForm } from './ui/ServiceForm';
import { Settings } from './ui/Settings';
import { addDays, clone, isValidDate, lastFolder, loadWeek, makeDocx, nextWeek, normalizeWeek, rememberFolder, rules, saveWeek, SIDS, upcomingSunday, weekdayOf, weekFileName, XML } from './ui/store';
import type { Mut } from './ui/store';
import { decodeText, TextImport } from './ui/TextImport';

interface LogEntry { level: 'ok' | 'warn' | 'error' | 'info'; text: string; path?: string }
type Modal = { kind: 'text'; initial: string } | { kind: 'settings' } | null;

const ORDINAL = ['', '첫째', '둘째', '셋째', '넷째', '다섯째'];
const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const hasContent = (w: WeekInput) =>
  Object.values(w.services).some((s) => Object.keys(s.people).length || Object.keys(s.lists).length || Object.keys(s.values).length || s.order?.length);

function Guard({ children, onReset }: { children: ComponentChildren; onReset: () => void }) {
  const [error, resetError] = useErrorBoundary();
  if (error) {
    return (
      <div class="crash">
        <h2>문제가 생겼습니다</h2>
        <pre>{errorText(error)}</pre>
        <button onClick={resetError}>다시 시도</button>
        <button class="danger" onClick={() => { onReset(); resetError(); }}>입력 지우고 다시 시작</button>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  const [week, setWeek] = useState<WeekInput>(() => loadWeek() ?? emptyWeek(upcomingSunday()));
  const [tab, setTab] = useState(() => {
    const t = localStorage.getItem('cuesheet.tab');
    return t && SIDS.includes(t) ? t : SIDS[0];
  });
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [pdf, setPdf] = useState<PdfSupport | null>(null);
  const [showRules, setShowRules] = useState(true);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [fit, setFit] = useState<Record<string, FitInfo>>({});
  const [tplVersion, setTplVersion] = useState(0);
  const [wordFont, setWordFont] = useState(false);

  useEffect(() => saveWeek(week), [week]);
  useEffect(() => localStorage.setItem('cuesheet.tab', tab), [tab]);
  useEffect(() => {
    pdfSupport().then(setPdf);
    loadWordFont().then(setWordFont);
  }, []);

  const sheets = useMemo(() => Object.fromEntries(SIDS.map((sid) => [sid, buildSheet(rules, sid, week)])) as Record<string, Sheet>, [week]);
  const sheet = sheets[tab];

  // the visible service's finished page and how much of it the sheet fills, from the DOCX itself
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await makeDocx(sheet);
        let page: PageRender | undefined, pageError: string | undefined;
        try {
          page = renderPage(r.page, { rowKeys: sheet.rows.map((x) => x.key), id: `cue-${tab}` }, new XML.DOMParser());
        } catch (e) {
          pageError = errorText(e);
        }
        if (!cancelled) setFit((f) => ({ ...f, [tab]: { pct: Math.round((r.fit.natural / r.fit.capacity) * 100), warnings: r.warnings, page, pageError } }));
      } catch (e) {
        if (!cancelled) setFit((f) => ({ ...f, [tab]: { pct: NaN, warnings: [], error: errorText(e) } }));
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [sheet, tab, tplVersion]);

  const update = (fn: Mut<WeekInput>) =>
    setWeek((w) => {
      const d = clone(w);
      fn(d);
      return d;
    });
  const updateSvc = (sid: string) => (fn: Mut<ServiceInput>) => update((w) => fn((w.services[sid] ??= emptyService())));

  const setDate = (d: string) => {
    if (isValidDate(d)) update((w) => void (w.date = d));
  };
  const newWeek = async () => {
    const next = addDays(week.date, 7);
    if (await confirmBox(`${next} 주일로 넘어갈까요?\n\n사람(출연·스태프)과 Mic 수는 그대로 두고, 찬양·본문·순서·특별순서 등은 비웁니다.`, '다음 주로'))
      setWeek(nextWeek(week));
  };
  const copyStaff = (to: string) => (from: string) =>
    update((w) => {
      for (const k of rules.staffOrder) {
        const v = w.services[from]?.people[k];
        if (v) w.services[to].people[k] = v;
        else delete w.services[to].people[k];
      }
    });

  const openInput = async () => {
    try {
      const f = await openFile({ name: '큐시트 입력', extensions: ['json', 'txt'] });
      if (!f) return;
      const text = decodeText(f.data);
      if (/\.txt$/i.test(f.name)) return setModal({ kind: 'text', initial: text });
      const w = normalizeWeek(JSON.parse(text));
      if (hasContent(week) && !(await confirmBox(`지금 입력을 “${f.name}” 내용으로 바꿀까요?`, '바꾸기'))) return;
      setWeek(w);
      setLog([{ level: 'ok', text: `열었습니다: ${f.name}` }]);
    } catch (e) {
      await alertBox(`열 수 없습니다: ${errorText(e)}`, 'error');
    }
  };
  const saveInput = async () => {
    try {
      const p = await saveFile(weekFileName(week), new TextEncoder().encode(JSON.stringify(week, null, 2)), { name: '큐시트 입력', extensions: ['json'] }, lastFolder());
      if (p != null) setLog([{ level: 'ok', text: `입력 저장: ${p ? fileName(p) : weekFileName(week)}`, path: p || undefined }]);
    } catch (e) {
      setLog([{ level: 'error', text: `입력을 저장하지 못했습니다 — ${writeErrorText(e)}` }]);
    }
  };

  const generate = async (withPdf: boolean) => {
    const targets = SIDS.filter((sid) => week.services[sid]?.include).map((sid) => sheets[sid]);
    if (!targets.length) return alertBox('만들 예배가 없습니다. 예배 탭에서 “이번 주 … 큐시트 만들기”를 켜세요.', 'warning');
    const entries: LogEntry[] = [];
    const push = (e: LogEntry) => {
      entries.push(e);
      setLog([...entries]);
    };
    setLog([]);
    try {
      setBusy('DOCX 만드는 중…');
      const docs: { sheet: Sheet; bytes: Uint8Array; warnings: string[] }[] = [];
      for (const s of targets) {
        try {
          const r = await makeDocx(s);
          docs.push({ sheet: s, bytes: r.bytes, warnings: r.warnings });
        } catch (e) {
          push({ level: 'error', text: `${s.label}: DOCX를 만들지 못했습니다 — ${errorText(e)}` });
        }
      }
      const report = (d: (typeof docs)[number]) => {
        d.warnings.forEach((w) => push({ level: 'warn', text: `${d.sheet.label}: ${w}` }));
        const n = d.sheet.warnings.filter((w) => w.level === 'warn').length;
        if (n) push({ level: 'info', text: `${d.sheet.label}: 가이드라인과 다른 점 ${n}개 — 미리보기의 “확인할 점”을 보세요` });
      };
      if (!docs.length) return;

      if (!inTauri || isMobile) {
        for (const d of docs) {
          const name = `${d.sheet.fileBase}.docx`;
          setBusy(`${d.sheet.label} 저장 중…`);
          try {
            const p = await saveFile(name, d.bytes, { name: 'Word 문서', extensions: ['docx'] });
            if (p == null) push({ level: 'info', text: `${name}: 저장 취소` });
            else push({ level: 'ok', text: p ? fileName(p) : `${name} (다운로드)`, path: p || undefined });
          } catch (e) {
            push({ level: 'error', text: `${name} 저장 실패 — ${writeErrorText(e)}` });
          }
          report(d);
        }
        if (withPdf) push({ level: 'warn', text: pdf?.reason ?? 'PDF는 데스크톱 앱에서만 만들 수 있습니다' });
        return;
      }

      setBusy('저장할 폴더를 고르세요…');
      const folder = await pickFolder(lastFolder());
      if (!folder) return push({ level: 'info', text: '취소했습니다' });
      rememberFolder(folder);
      const plan = [];
      for (const d of docs) plan.push({ ...d, docx: await joinPath(folder, `${d.sheet.fileBase}.docx`), pdf: await joinPath(folder, `${d.sheet.fileBase}.pdf`) });
      const existing: string[] = [];
      for (const p of plan) for (const f of withPdf ? [p.docx, p.pdf] : [p.docx]) if (await fileExists(f)) existing.push(fileName(f));
      if (existing.length && !(await confirmBox(`같은 이름의 파일이 있습니다. 덮어쓸까요?\n\n${existing.join('\n')}`, '덮어쓰기'))) return push({ level: 'info', text: '취소했습니다' });

      for (const p of plan) {
        setBusy(`${p.sheet.label} DOCX 저장 중…`);
        try {
          await writeBytes(p.docx, p.bytes);
          push({ level: 'ok', text: fileName(p.docx), path: p.docx });
        } catch (e) {
          push({ level: 'error', text: `${fileName(p.docx)} 저장 실패 — ${writeErrorText(e)}` });
          continue;
        }
        report(p);
        if (!withPdf) continue;
        setBusy(`${p.sheet.label} PDF 만드는 중… (Microsoft Word)`);
        try {
          const r = await exportPdf(p.docx, p.pdf);
          if (r.pages != null && r.pages > 1) push({ level: 'warn', text: `${fileName(p.pdf)} — ${r.pages}쪽입니다 (가이드라인: 한 페이지). 긴 칸을 줄여 다시 만드세요`, path: p.pdf });
          else push({ level: 'ok', text: `${fileName(p.pdf)}${r.pages ? ` (${r.pages}쪽)` : ''}`, path: p.pdf });
        } catch (e) {
          push({ level: 'error', text: `${p.sheet.label} PDF 실패 — ${errorText(e)}` });
        }
      }
    } finally {
      setBusy(null);
    }
  };

  const wd = weekdayOf(week.date);
  const pdfOk = !!pdf?.available;
  const included = SIDS.filter((sid) => week.services[sid]?.include);

  return (
    <div class="app">
      <header class="toolbar">
        <div class="brand">큐시트 메이커</div>
        <div class="date">
          <input type="date" value={week.date} onInput={(e) => setDate(e.currentTarget.value)} />
          <span class={wd === 0 ? 'muted' : 'warn-text'}>{wd === 0 ? `${ORDINAL[sundayIndex(week.date)] ?? ''} 주일` : '일요일이 아닙니다'}</span>
          <button onClick={newWeek} title="날짜를 1주 뒤로 옮기고 이번 주 내용 비우기">다음 주 ▸</button>
        </div>
        <div class="group">
          <button onClick={() => setModal({ kind: 'text', initial: '' })}>텍스트로 입력</button>
          <button onClick={openInput}>열기…</button>
          <button onClick={saveInput}>저장…</button>
        </div>
        <div class="group right">
          <button class="primary" disabled={!!busy || !included.length} onClick={() => generate(false)}>
            DOCX 만들기
          </button>
          <button class="primary" disabled={!!busy || !included.length || !pdfOk} title={pdfOk ? 'DOCX를 만들고 Microsoft Word로 PDF 저장' : pdf?.reason ?? ''} onClick={() => generate(true)}>
            DOCX + PDF
          </button>
          <button class="ghost" title="설정" onClick={() => setModal({ kind: 'settings' })}>⚙︎</button>
        </div>
      </header>

      <nav class="tabs">
        {SIDS.map((sid) => {
          const n = sheets[sid].warnings.filter((w) => w.level === 'warn').length;
          const inc = week.services[sid]?.include;
          return (
            <button key={sid} class={`tab ${tab === sid ? 'active' : ''} ${inc ? '' : 'off'}`} onClick={() => { setTab(sid); setHighlight(null); }}>
              {rules.services[sid].label}
              {!inc && <span class="muted"> (안 만듦)</span>}
              {inc && n > 0 && <span class="badge warn" title="가이드라인과 다른 점">{n}</span>}
            </button>
          );
        })}
        <span class="muted tabs-note">각 예배는 사람·찬양·순서·시간을 따로 입력합니다</span>
      </nav>

      <Guard onReset={() => setWeek(emptyWeek(upcomingSunday()))}>
        <main class="main">
          <div class="pane left">
            <ServiceForm key={tab} sid={tab} input={week.services[tab] ?? emptyService(false)} sheet={sheet} onChange={updateSvc(tab)} onCopyStaff={copyStaff(tab)} />
          </div>
          <div class="pane right">
            <Preview
              sheet={sheet}
              included={!!week.services[tab]?.include}
              fit={fit[tab]}
              wordFont={wordFont}
              showRules={showRules}
              onShowRules={setShowRules}
              highlight={highlight}
              onHighlight={setHighlight}
            />
          </div>
        </main>
      </Guard>

      {(log.length > 0 || busy) && (
        <footer class="log">
          {busy && <div class="busy"><span class="spinner" /> {busy}</div>}
          {log.map((l, i) => (
            <div key={i} class={`log-${l.level}`}>
              {l.level === 'ok' ? '✓' : l.level === 'error' ? '✕' : l.level === 'warn' ? '⚠︎' : '•'} {l.text}
              {l.path && inTauri && !isMobile && (
                <button class="link" onClick={() => reveal(l.path!).catch((e) => alertBox(errorText(e), 'error'))}>{revealLabel}</button>
              )}
            </div>
          ))}
          {!busy && <button class="ghost close" title="닫기" onClick={() => setLog([])}>✕</button>}
        </footer>
      )}

      {modal?.kind === 'text' && (
        <TextImport
          week={week}
          initial={modal.initial}
          onClose={() => setModal(null)}
          onApply={(w, services) => {
            setWeek(w);
            setModal(null);
            if (!services.includes(tab)) setTab(services[0]);
            setLog([{ level: 'ok', text: `텍스트 적용: ${services.map((s) => rules.services[s].label).join(', ')} (${w.date})` }]);
          }}
        />
      )}
      {modal?.kind === 'settings' && (
        <Settings
          sheets={sheets}
          pdf={pdf}
          onTemplatesChanged={() => setTplVersion((v) => v + 1)}
          onResetWeek={() => setWeek(emptyWeek(upcomingSunday()))}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
