import { invoke, isTauri } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { ask, message, open, save } from '@tauri-apps/plugin-dialog';
import { exists, readFile, writeFile } from '@tauri-apps/plugin-fs';

/** Running inside the Tauri app (not a plain browser tab during development). */
export const inTauri = isTauri();
const ua = navigator.userAgent;
export const isMobile = /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
/** Desktop app: can pick a folder, write several files into it, and export PDF with Word. */
export const isDesktop = inTauri && !isMobile;
export const isWindows = /Windows/i.test(ua);
export const revealLabel = isWindows ? '탐색기에서 보기' : 'Finder에서 보기';

const TITLE = '큐시트 메이커';

export interface PdfSupport { available: boolean; reason: string | null }

export async function pdfSupport(): Promise<PdfSupport> {
  if (!inTauri) return { available: false, reason: '브라우저에서는 PDF를 만들 수 없습니다 — 데스크톱 앱을 사용하세요' };
  if (isMobile) return { available: false, reason: '휴대폰·태블릿에서는 PDF를 만들 수 없습니다 (Microsoft Word 데스크톱 필요)' };
  try {
    return await invoke<PdfSupport>('pdf_support');
  } catch (e) {
    return { available: false, reason: errorText(e) };
  }
}

/** Saves `docx` as `pdf` with Microsoft Word. */
export const exportPdf = (docx: string, pdf: string) => invoke<{ pages: number | null }>('export_pdf', { docx, pdf });
export const reveal = (path: string) => invoke<void>('reveal', { path });

let wordFont: Promise<boolean> | null = null;
/**
 * Makes Word's own 맑은 고딕 (the templates' font) available to the preview as 'CueMalgun', read
 * from the installed Word (Windows: the system font). Resolves false where there is none; the
 * preview then draws the same layout with a look-alike font.
 */
export function loadWordFont(): Promise<boolean> {
  return (wordFont ??= (async () => {
    if (!inTauri || isMobile || typeof FontFace === 'undefined') return false;
    try {
      const faces = await Promise.all(
        [false, true].map(async (bold) => {
          const data = await invoke<ArrayBuffer>('word_font', { bold });
          return new FontFace('CueMalgun', data, { weight: bold ? '700' : '400' }).load();
        }),
      );
      faces.forEach((f) => document.fonts.add(f));
      return true;
    } catch {
      return false;
    }
  })());
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e));

export async function pickFolder(defaultPath?: string): Promise<string | null> {
  const r = await open({ directory: true, recursive: true, defaultPath, title: '큐시트를 저장할 폴더 선택' });
  return typeof r === 'string' ? r : null;
}

export const joinPath = (dir: string, name: string) => join(dir, name);
export const fileExists = (path: string) => exists(path);
export const writeBytes = (path: string, data: Uint8Array) => writeFile(path, data);

/** Browser download (development in a plain browser tab). */
export function download(name: string, data: Uint8Array, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Saves one file with a save dialog. Returns the path, '' for a browser download, or null when cancelled. */
export async function saveFile(name: string, data: Uint8Array, filter: { name: string; extensions: string[] }, defaultDir?: string): Promise<string | null> {
  if (!inTauri) {
    download(name, data);
    return '';
  }
  const defaultPath = defaultDir && !isMobile ? await join(defaultDir, name) : name;
  const path = await save({ defaultPath, filters: [filter], title: '저장' });
  if (!path) return null;
  await writeFile(path, data);
  return path;
}

/** Lets the user pick one file and reads it. */
export async function openFile(filter: { name: string; extensions: string[] }): Promise<{ name: string; data: Uint8Array } | null> {
  if (inTauri) {
    const p = await open({ multiple: false, directory: false, filters: [filter], title: '열기' });
    if (typeof p !== 'string') return null;
    return { name: p.split(/[\\/]/).pop() ?? p, data: await readFile(p) };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = filter.extensions.map((e) => `.${e}`).join(',');
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, data: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    input.click();
  });
}

export async function confirmBox(text: string, okLabel = '예'): Promise<boolean> {
  if (!inTauri) return window.confirm(text);
  return ask(text, { title: TITLE, kind: 'warning', okLabel, cancelLabel: '취소' });
}

export async function alertBox(text: string, kind: 'info' | 'warning' | 'error' = 'info') {
  if (!inTauri) {
    window.alert(text);
    return;
  }
  await message(text, { title: TITLE, kind });
}

/** Adds a hint to file-write errors that usually mean the file is open in Word. */
export function writeErrorText(e: unknown): string {
  const t = errorText(e);
  if (/os error (32|33|5)\b|being used|denied|EBUSY|EPERM/i.test(t)) return `${t} — 파일이 Word에서 열려 있으면 닫고 다시 시도하세요`;
  return t;
}
