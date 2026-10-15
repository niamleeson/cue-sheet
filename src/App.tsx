import type { ComponentChildren } from 'preact';
import { useEffect, useErrorBoundary, useMemo, useRef, useState } from 'preact/hooks';
import './App.css';
import { resetCell, saveCell } from './core/cellsave';
import { clone, docId, docServices, emptyDoc, occasionOf } from './core/doc';
import { buildDoc } from './core/engine';
import { renderPage } from './core/render';
import type { PageRender } from './core/render';
import type { CueDoc, Kind, Sheet } from './core/types';
import { svcLabel } from './ui/fields';
import type { Change } from './ui/fields';
import { docFromFile, dropDoc, flushDocs, loadLibrary, loadUi, putDoc, retireV1Week, saveUi, takeV1Week, unsaved, waiting } from './ui/library';
import type { Library, UiState } from './ui/library';
import { dateHint, NewDocDialog, suggestDate } from './ui/NewDocDialog';
import { alertBox, confirmBox, errorText, exportPdf, fileExists, inTauri, isMobile, joinPath, loadWordFont, openFile, pdfSupport, pickFolder, reveal, revealLabel, saveFile, writeBytes, writeErrorText } from './ui/platform';
import type { PdfSupport } from './ui/platform';
import { Preview } from './ui/Preview';
import type { FitInfo, OpenCell } from './ui/Preview';
import { ServiceForm } from './ui/ServiceForm';
import { Settings } from './ui/Settings';
import { isValidDate, lastFolder, makeDocx, ONE_PAGE, rememberFolder, rules, XML } from './ui/store';
import { decodeText, TextImport } from './ui/TextImport';

interface LogEntry { level: 'ok' | 'warn' | 'error' | 'info'; text: string; path?: string }
type Modal = { kind: 'text'; initial: string } | { kind: 'settings' } | { kind: 'new' } | null;
type SaveState = { state: 'saved' | 'saving' } | { state: 'error'; error: string };

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const occLabel = (kind: Kind) => occasionOf(rules, kind).label;
const docTitle = (d: CueDoc) => `${occLabel(d.kind)} ${d.date}`;
const sameDoc = (a: CueDoc, b: CueDoc) => JSON.stringify({ ...a, updatedAt: '' }) === JSON.stringify({ ...b, updatedAt: '' });
const without = <T,>(m: Record<string, T>, id: string) => {
  const { [id]: _, ...rest } = m;
  return rest;
};

function Guard({ children, onReset }: { children: ComponentChildren; onReset: () => void }) {
  const [error, resetError] = useErrorBoundary();
  if (error) {
    return (
      <div class="crash">
        <h2>문제가 생겼습니다</h2>
        <pre>{errorText(error)}</pre>
        <button onClick={resetError}>다시 시도</button>
        <button class="danger" onClick={() => { onReset(); resetError(); }}>이 큐시트 처음부터</button>
      </div>
    );
  }
  return <>{children}</>;
}

/** The cue sheet's date: typed freely, applied on Enter or when leaving the box (back to the date when not applied). */
function DateBox({ doc, onCommit }: { doc: CueDoc; onCommit: (date: string) => Promise<boolean> }) {
  const [text, setText] = useState(doc.date);
  useEffect(() => setText(doc.date), [doc.date]);
  const apply = () => {
    if (text === doc.date) return;
    if (isValidDate(text) && Number(text.slice(0, 4)) >= 2000) {
      const was = doc.date;
      void onCommit(text).then((ok) => !ok && setText(was));
    } else setText(doc.date);
  };
  const hint = dateHint(doc.kind, doc.date);
  return (
    <label class="date">
      날짜
      <input type="date" value={text} onInput={(e) => setText(e.currentTarget.value)} onBlur={apply} onKeyDown={(e) => e.key === 'Enter' && apply()} />
      <span class={hint.warn ? 'warn-text' : 'muted'}>{hint.text}</span>
    </label>
  );
}

export default function App() {
  const [lib, setLib] = useState<Record<string, CueDoc> | null>(null);
  const [ui, setUi] = useState<UiState>(loadUi);
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [pdf, setPdf] = useState<PdfSupport | null>(null);
  const [showRules, setShowRules] = useState(true);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [cell, setCell] = useState<OpenCell | null>(null);
  const [fit, setFit] = useState<Record<string, FitInfo>>({});
  const [tplVersion, setTplVersion] = useState(0);
  const [wordFont, setWordFont] = useState(false);
  const [save, setSave] = useState<SaveState>({ state: 'saved' });
  const [toast, setToast] = useState<string | null>(null);

  const blanks = useRef<Partial<Record<Kind, CueDoc>>>({});
  const docRef = useRef<CueDoc | null>(null);
  const commitRef = useRef<(() => boolean) | null>(null);
  const pdfProbe = useRef<Promise<PdfSupport> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const leftPane = useRef<HTMLDivElement>(null);

  // ---------- saving: every change is kept as a draft at once and written to its file shortly after ----------
  /** writes what is waiting; the first failure (kept for the next try), or null */
  const flush = async (): Promise<unknown> => {
    clearTimeout(timer.current);
    if (!unsaved()) {
      setSave({ state: 'saved' });
      return null;
    }
    setSave({ state: 'saving' });
    try {
      await flushDocs();
      if (!unsaved()) setSave({ state: 'saved' });
      return null;
    } catch (e) {
      setSave({ state: 'error', error: errorText(e) });
      return e;
    }
  };
  const schedule = (d: CueDoc) => {
    putDoc(d);
    setSave((s) => (s.state === 'error' ? s : { state: 'saving' }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 300);
  };
  const commit = (d: CueDoc) => {
    d.updatedAt = new Date().toISOString();
    docRef.current = d;
    setLib((l) => ({ ...l, [d.id]: d }));
    setUi((u) => (u.kind === d.kind && u.doc[d.kind] === d.id ? u : { ...u, kind: d.kind, doc: { ...u.doc, [d.kind]: d.id } }));
    schedule(d);
  };
  const change: Change = (fn) => {
    const cur = docRef.current;
    if (!cur) return;
    const next = clone(cur);
    fn(next);
    if (!sameDoc(next, cur)) commit(next);
  };
  const showToast = (text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  };

  useEffect(() => {
    const probe = pdfSupport();
    pdfProbe.current = probe;
    probe.then(setPdf);
    loadWordFont().then(setWordFont);
    (async () => {
      const notes: LogEntry[] = [];
      let l: Library;
      try {
        l = await loadLibrary();
      } catch (e) {
        l = { docs: [], recovered: [], skipped: 0 };
        notes.push({ level: 'error', text: `저장된 큐시트를 읽지 못했습니다 — ${errorText(e)}` });
      }
      const map: Record<string, CueDoc> = Object.fromEntries(l.docs.map((d) => [d.id, d]));
      if (l.recovered.length) {
        for (const d of l.recovered) putDoc(d);
        notes.push({ level: 'info', text: `앱을 닫기 직전의 변경을 되살렸습니다 (${l.recovered.map(docTitle).join(', ')})` });
      }
      if (l.skipped) notes.push({ level: 'warn', text: `읽을 수 없는 저장 파일 ${l.skipped}개는 건너뛰었습니다` });
      if (!l.docs.length) {
        const v1 = takeV1Week();
        if (v1) {
          map[v1.id] = v1;
          putDoc(v1);
          try {
            await flushDocs();
            retireV1Week();
            notes.push({ level: 'ok', text: `이전 버전에서 입력하던 ${v1.date} 주일 큐시트를 가져왔습니다` });
          } catch (e) {
            notes.push({ level: 'error', text: `이전 버전의 입력을 저장하지 못했습니다 — ${errorText(e)}` });
          }
        }
      }
      setLib(map);
      if (notes.length) setLog(notes);
      if (unsaved()) void flush();
    })();
    const leave = () => void flush();
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, []);
  useEffect(() => saveUi(ui), [ui]);

  // ---------- the open cue sheet ----------
  const kind = ui.kind;
  const ofKind = useMemo(() => (lib ? Object.values(lib).filter((d) => d.kind === kind) : []), [lib, kind]);
  let doc: CueDoc | null = null;
  if (lib) {
    const id = ui.doc[kind];
    doc =
      (id ? lib[id] : undefined) ??
      ofKind.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ??
      (blanks.current[kind] ??= emptyDoc(rules, kind, suggestDate(kind, (x) => !!lib[x])));
  }
  docRef.current = doc;
  const saved = !!(doc && lib?.[doc.id]);
  const services = doc ? docServices(rules, doc) : [];
  const sid = services.includes(ui.svc[kind] ?? '') ? ui.svc[kind]! : services[0];
  const sheets = useMemo(() => (doc ? buildDoc(rules, doc) : []), [doc]);
  const sheet: Sheet | undefined = sheets.find((s) => s.serviceId === sid);
  const fitKey = doc && sid ? `${doc.id}|${sid}` : '';

  // the visible service's finished page and how much of it the sheet fills, from the DOCX itself
  useEffect(() => {
    if (!sheet || !fitKey) return;
    let cancelled = false;
    const key = fitKey;
    const t = setTimeout(async () => {
      try {
        const r = await makeDocx(sheet);
        let page: PageRender | undefined, pageError: string | undefined;
        try {
          page = renderPage(r.page, { rowKeys: sheet.rows.map((x) => x.key), id: `cue-${sheet.serviceId}` }, new XML.DOMParser());
        } catch (e) {
          pageError = errorText(e);
        }
        if (!cancelled) setFit((f) => ({ ...f, [key]: { pct: Math.round((r.fit.natural / r.fit.capacity) * 100), warnings: r.warnings, page, pageError, sheet } }));
      } catch (e) {
        if (!cancelled) setFit((f) => ({ ...f, [key]: { pct: NaN, warnings: [], error: errorText(e), sheet } }));
      }
    }, fit[key] ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [sheet, fitKey, tplVersion]);
  // another cue sheet starts at the top of the form (a service tab keeps the place, to compare services)
  useEffect(() => leftPane.current?.scrollTo({ top: 0 }), [doc?.id]);

  /** saves and closes the open cell; false when it could not be saved (it stays open, and nothing else happens) */
  const leaveCell = () => {
    const save = commitRef.current;
    if (save && !save()) return false;
    setCell(null);
    setHighlight(null);
    return true;
  };
  const pickKind = (k: Kind) => {
    if (k === kind || !leaveCell()) return;
    setUi((u) => ({ ...u, kind: k }));
  };
  const pickService = (s: string) => {
    if (s === sid || !leaveCell()) return;
    setUi((u) => ({ ...u, svc: { ...u.svc, [kind]: s } }));
  };
  const pickDoc = (id: string) => {
    if (!leaveCell()) return false;
    setUi((u) => ({ ...u, doc: { ...u.doc, [kind]: id } }));
    return true;
  };

  /** moves the cue sheet to another date; false when it did not move */
  const changeDate = async (date: string) => {
    const cur = docRef.current;
    if (!cur || !lib || date === cur.date) return true;
    if (!leaveCell()) return false;
    const id = docId(cur.kind, date);
    if (lib[id] && !(await confirmBox(`${occLabel(cur.kind)} ${date} 큐시트가 이미 있습니다.\n이 큐시트를 그 날짜로 옮기면 원래 ${date} 큐시트는 지워집니다.`, '옮기기'))) return false;
    const next = clone(docRef.current ?? cur);
    next.id = id;
    next.date = date;
    // the file under the old date goes (if there is none yet, nothing happens)
    dropDoc(cur.id);
    setLib((l) => without(l ?? {}, cur.id));
    commit(next);
    return true;
  };
  const removeDoc = async () => {
    const cur = docRef.current;
    if (!cur || !saved) return;
    if (!(await confirmBox(`${docTitle(cur)} 큐시트를 지울까요? 되돌릴 수 없습니다.`, '지우기'))) return;
    setCell(null);
    dropDoc(cur.id);
    setLib((l) => without(l ?? {}, cur.id));
    setUi((u) => {
      const d = { ...u.doc };
      delete d[cur.kind];
      return { ...u, doc: d };
    });
    const err = await flush();
    if (waiting(cur.id)) setLog([{ level: 'error', text: `파일을 지우지 못했습니다 — ${errorText(err)} (다시 저장할 때 또 지웁니다)` }]);
    else setLog([{ level: 'ok', text: `지웠습니다: ${docTitle(cur)}` }]);
  };
  const resetDoc = () => {
    const cur = docRef.current;
    if (!cur) return;
    setCell(null);
    commit(emptyDoc(rules, cur.kind, cur.date));
  };

  // ---------- cells typed in the preview ----------
  const saveEdit = (c: OpenCell, text: string, scope: string[]) => {
    const cur = docRef.current;
    if (!cur || cur.id !== c.doc) {
      setCell(null);
      return true;
    }
    try {
      const r = saveCell(rules, cur, { sid: c.sid, row: c.row, col: c.col, text, scope });
      setCell(null);
      if (sameDoc(r.doc, cur)) return true;
      commit(r.doc);
      const where = scope.length ? ` — ${[c.sid, ...scope].map(svcLabel).join('·')}` : '';
      showToast(`${r.changes.length ? r.changes.join(', ') : '칸 변경 기록'}${where}`);
      return true;
    } catch (e) {
      void alertBox(`저장하지 못했습니다: ${errorText(e)}`, 'error');
      return false;
    }
  };
  const resetEdit = (c: OpenCell) => {
    const cur = docRef.current;
    if (!cur || cur.id !== c.doc) return;
    setCell(null);
    commit(resetCell(cur, c.sid, c.row, c.col));
    showToast('고친 내용을 지웠습니다');
  };

  // ---------- files ----------
  const openInput = async () => {
    if (!leaveCell()) return;
    try {
      const f = await openFile({ name: '큐시트', extensions: ['json', 'txt'] });
      if (!f) return;
      const text = decodeText(f.data);
      if (/\.txt$/i.test(f.name)) return setModal({ kind: 'text', initial: text });
      const d = docFromFile(text);
      if (lib?.[d.id] && !(await confirmBox(`${docTitle(d)} 큐시트가 이미 있습니다. “${f.name}” 내용으로 바꿀까요?`, '바꾸기'))) return;
      commit(d);
      setLog([{ level: 'ok', text: `열었습니다: ${f.name} (${docTitle(d)})` }]);
    } catch (e) {
      await alertBox(`열 수 없습니다: ${errorText(e)}`, 'error');
    }
  };
  const saveInput = async () => {
    if (!leaveCell()) return;
    const d = docRef.current;
    if (!d) return;
    const name = `${docTitle(d)}.cuesheet.json`;
    try {
      const p = await saveFile(name, new TextEncoder().encode(JSON.stringify(d, null, 1)), { name: '큐시트', extensions: ['json'] }, lastFolder());
      if (p != null) setLog([{ level: 'ok', text: `큐시트 파일 저장: ${p ? fileName(p) : name}`, path: p || undefined }]);
    } catch (e) {
      setLog([{ level: 'error', text: `큐시트 파일을 저장하지 못했습니다 — ${writeErrorText(e)}` }]);
    }
  };

  const generate = async () => {
    if (!leaveCell()) return;
    const d = docRef.current;
    if (!d) return;
    const entries: LogEntry[] = [];
    const push = (e: LogEntry) => {
      entries.push(e);
      setLog([...entries]);
    };
    setLog([]);
    try {
      setBusy('DOCX 만드는 중…');
      const targets = buildDoc(rules, d);
      // right after the app opens, the check for Word may still be running
      const support = pdf ?? (await pdfProbe.current);
      const withPdf = !!support?.available;
      const docs: { sheet: Sheet; bytes: Uint8Array; warnings: string[] }[] = [];
      for (const s of targets) {
        try {
          const r = await makeDocx(s);
          docs.push({ sheet: s, bytes: r.bytes, warnings: r.warnings });
        } catch (e) {
          push({ level: 'error', text: `${s.label}: DOCX를 만들지 못했습니다 — ${errorText(e)}` });
        }
      }
      const report = (x: (typeof docs)[number]) => {
        x.warnings.forEach((w) => push({ level: 'warn', text: `${x.sheet.label}: ${w}` }));
        const n = x.sheet.warnings.filter((w) => w.level === 'warn').length;
        if (n) push({ level: 'info', text: `${x.sheet.label}: 가이드라인과 다른 점 ${n}개 — 미리보기의 “확인할 점”을 보세요` });
      };
      if (!docs.length) return;

      if (!inTauri || isMobile) {
        for (const x of docs) {
          const name = `${x.sheet.fileBase}.docx`;
          setBusy(`${x.sheet.label} 저장 중…`);
          try {
            const p = await saveFile(name, x.bytes, { name: 'Word 문서', extensions: ['docx'] });
            if (p == null) push({ level: 'info', text: `${name}: 저장 취소` });
            else push({ level: 'ok', text: p ? fileName(p) : `${name} (다운로드)`, path: p || undefined });
          } catch (e) {
            push({ level: 'error', text: `${name} 저장 실패 — ${writeErrorText(e)}` });
          }
          report(x);
        }
        push({ level: 'warn', text: `PDF는 만들지 않았습니다 — ${support?.reason ?? 'PDF는 데스크톱 앱에서만 만들 수 있습니다'}` });
        return;
      }

      setBusy('저장할 폴더를 고르세요…');
      const folder = await pickFolder(lastFolder());
      if (!folder) return push({ level: 'info', text: '취소했습니다' });
      rememberFolder(folder);
      const plan = [];
      for (const x of docs) plan.push({ ...x, docx: await joinPath(folder, `${x.sheet.fileBase}.docx`), pdf: await joinPath(folder, `${x.sheet.fileBase}.pdf`) });
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
          if (r.pages != null && r.pages > 1 && ONE_PAGE.has(p.sheet.serviceId)) push({ level: 'warn', text: `${fileName(p.pdf)} — ${r.pages}쪽입니다. 주일 큐시트는 한 페이지로 — 긴 칸을 줄여 다시 만드세요`, path: p.pdf });
          else push({ level: 'ok', text: `${fileName(p.pdf)}${r.pages ? ` (${r.pages}쪽)` : ''}`, path: p.pdf });
        } catch (e) {
          push({ level: 'error', text: `${p.sheet.label} PDF 실패 — ${errorText(e)}` });
        }
      }
      if (!withPdf) push({ level: 'warn', text: `PDF는 만들지 않았습니다 — ${support?.reason ?? 'Microsoft Word를 찾지 못했습니다'}` });
    } catch (e) {
      push({ level: 'error', text: `큐시트를 만들지 못했습니다 — ${errorText(e)}` });
    } finally {
      setBusy(null);
    }
  };

  if (!lib || !doc || !sid || !sheet) {
    return (
      <div class="app">
        <div class="loading"><span class="spinner" /> 불러오는 중…</div>
      </div>
    );
  }

  const sorted = ofKind.slice().sort((a, b) => b.date.localeCompare(a.date));
  const label = services.map(svcLabel).join('·');
  const genTitle = `${label} 큐시트를 한 번에 만듭니다${pdf?.available ? ' (PDF는 Microsoft Word로)' : pdf ? ` — PDF는 만들 수 없어 DOCX만: ${pdf.reason ?? ''}` : ''}`;

  return (
    <div class="app">
      <header class="toolbar">
        <div class="brand">큐시트 메이커</div>
        <div class="group">
          <select
            class="doc-pick"
            value={doc.id}
            title="저장된 큐시트"
            onChange={(e) => {
              if (!pickDoc(e.currentTarget.value)) e.currentTarget.value = doc.id;
            }}
          >
            {!saved && <option value={doc.id}>{doc.date} {dateHint(kind, doc.date).text} (새)</option>}
            {sorted.map((d) => (
              <option key={d.id} value={d.id}>{d.date} · {dateHint(kind, d.date).text}</option>
            ))}
          </select>
          <button onClick={() => leaveCell() && setModal({ kind: 'new' })} title="지난 큐시트를 바탕으로, 또는 빈 큐시트로 시작">+ 새 큐시트…</button>
          <button class="ghost" disabled={!saved} title="이 큐시트 지우기" onClick={removeDoc}>🗑</button>
        </div>
        <div class="group">
          <button onClick={() => leaveCell() && setModal({ kind: 'text', initial: '' })}>텍스트로 입력</button>
          <button onClick={openInput} title="큐시트 파일(.json) 또는 텍스트(.txt) 열기">열기…</button>
          <button onClick={saveInput} title="이 큐시트를 파일로 저장 (다른 컴퓨터로 옮길 때)">저장…</button>
        </div>
        <div class="group right">
          <SaveBadge save={save} saved={saved} onRetry={() => void flush()} />
          <button class="primary" disabled={!!busy} title={genTitle} onClick={generate}>
            DOCX + PDF
          </button>
          <button class="ghost" title="설정" onClick={() => leaveCell() && setModal({ kind: 'settings' })}>⚙︎</button>
        </div>
      </header>

      <nav class="occasions" aria-label="행사">
        {rules.occasions.map((o) => (
          <button key={o.id} class={`occ ${o.id === kind ? 'active' : ''}`} onClick={() => pickKind(o.id)}>
            {o.label}
          </button>
        ))}
      </nav>

      <nav class="tabs docbar">
        {services.length > 1 &&
          services.map((s) => {
            const n = sheets.find((x) => x.serviceId === s)?.warnings.filter((w) => w.level === 'warn').length ?? 0;
            return (
              <button key={s} class={`tab ${sid === s ? 'active' : ''}`} onClick={() => pickService(s)}>
                {svcLabel(s)}
                {n > 0 && <span class="badge warn" title="가이드라인과 다른 점">{n}</span>}
              </button>
            );
          })}
        {services.length === 1 && <span class="tab active">{svcLabel(sid)}</span>}
        <DateBox doc={doc} onCommit={changeDate} />
      </nav>

      <Guard onReset={resetDoc}>
        <main class="main">
          <div class="pane left" ref={leftPane}>
            <ServiceForm
              key={`${doc.id}|${sid}`}
              doc={doc}
              sid={sid}
              sheet={sheet}
              services={services}
              change={change}
              highlight={highlight}
              onHighlight={setHighlight}
              onOpenCell={(row, col) => setCell({ doc: doc.id, sid, row, col })}
            />
          </div>
          <div class="pane right">
            <Preview
              doc={doc}
              sid={sid}
              sheet={sheet}
              sheets={sheets}
              fit={fit[fitKey]}
              wordFont={wordFont}
              showRules={showRules}
              onShowRules={setShowRules}
              highlight={highlight}
              onHighlight={setHighlight}
              cell={cell && cell.doc === doc.id && cell.sid === sid ? cell : null}
              onCell={setCell}
              onSave={saveEdit}
              onReset={resetEdit}
              commitRef={commitRef}
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
      {toast && <div class="toast" role="status">{toast}</div>}

      {modal?.kind === 'text' && (
        <TextImport
          doc={doc}
          lib={lib}
          initial={modal.initial}
          onClose={() => setModal(null)}
          onApply={(next, found) => {
            commit(next);
            setModal(null);
            if (found.length && !found.includes(sid)) setUi((u) => ({ ...u, svc: { ...u.svc, [next.kind]: found[0] } }));
            setLog([{ level: 'ok', text: `텍스트 적용: ${docTitle(next)} — ${found.map(svcLabel).join(', ')}` }]);
          }}
        />
      )}
      {modal?.kind === 'new' && (
        <NewDocDialog
          kind={kind}
          docs={ofKind}
          onClose={() => setModal(null)}
          onCreate={(d) => {
            commit(d);
            setModal(null);
            setLog([{ level: 'ok', text: `새 큐시트: ${docTitle(d)}` }]);
          }}
        />
      )}
      {modal?.kind === 'settings' && (
        <Settings
          sheets={sheets}
          docLabel={docTitle(doc)}
          pdf={pdf}
          onTemplatesChanged={() => setTplVersion((v) => v + 1)}
          onResetDoc={resetDoc}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function SaveBadge({ save, saved, onRetry }: { save: SaveState; saved: boolean; onRetry: () => void }) {
  if (save.state === 'error') {
    return (
      <button class="save-state error" title={`${save.error}\n눌러서 다시 저장`} onClick={onRetry}>
        ⚠︎ 저장 실패
      </button>
    );
  }
  if (!saved) return <span class="save-state muted" title="입력을 시작하면 자동으로 저장됩니다">새 큐시트</span>;
  return <span class={`save-state ${save.state}`}>{save.state === 'saving' ? '저장 중…' : '✓ 저장됨'}</span>;
}

