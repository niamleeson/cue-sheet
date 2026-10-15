/**
 * Saved cue sheet documents. In the desktop app every document is a JSON file in the app's data folder (one per
 * occasion and date, `<kind>-<date>.json`); in a plain browser tab they live in localStorage. A copy of every changed
 * document is also kept in localStorage at once (its draft), so a change made just before the app closed is not lost
 * while its file write was still waiting.
 */
import { invoke } from '@tauri-apps/api/core';
import { normalizeDoc } from '../core/doc';
import { v1WeekDoc, weekToDoc } from '../core/migrate';
import type { CueDoc, Kind } from '../core/types';
import { inTauri } from './platform';
import { createSaver } from './saver';
import { normalizeWeek, rules } from './store';

const DOC_KEY = 'cuesheet.docs.';
const DRAFT_KEY = 'cuesheet.draft.';
const V1_KEY = 'cuesheet.week';
const UI_KEY = 'cuesheet.ui';

const parse = (text: string): CueDoc | null => {
  try {
    return normalizeDoc(rules, JSON.parse(text));
  } catch {
    return null;
  }
};
const newer = (a: CueDoc, b: CueDoc) => Date.parse(a.updatedAt) > Date.parse(b.updatedAt);

const keysWith = (prefix: string): string[] => {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(prefix)) out.push(k);
  }
  return out;
};

export interface Library {
  docs: CueDoc[];
  /** drafts newer than their saved files (the app closed before the last changes were written) */
  recovered: CueDoc[];
  /** files that could not be read as cue sheet documents */
  skipped: number;
}

/** Every saved document (one per id, the newest), with the drafts that are newer than their files. */
export async function loadLibrary(): Promise<Library> {
  const texts = inTauri ? await invoke<string[]>('docs_list') : keysWith(DOC_KEY).map((k) => localStorage.getItem(k) ?? '');
  const byId = new Map<string, CueDoc>();
  let skipped = 0;
  for (const t of texts) {
    const d = parse(t);
    if (!d) skipped++;
    else if (!byId.has(d.id) || newer(d, byId.get(d.id)!)) byId.set(d.id, d);
  }
  const recovered: CueDoc[] = [];
  for (const k of keysWith(DRAFT_KEY)) {
    const d = parse(localStorage.getItem(k) ?? '');
    if (d && (!byId.has(d.id) || newer(d, byId.get(d.id)!))) {
      byId.set(d.id, d);
      recovered.push(d);
    } else localStorage.removeItem(k);
  }
  return { docs: [...byId.values()], recovered, skipped };
}

const saver = createSaver<CueDoc>({
  async write(id, doc) {
    const json = JSON.stringify(doc, null, 1);
    if (inTauri) await invoke('doc_write', { id, json });
    else localStorage.setItem(DOC_KEY + id, json);
  },
  async remove(id) {
    if (inTauri) await invoke('doc_delete', { id });
    else localStorage.removeItem(DOC_KEY + id);
  },
  // the draft goes once its file has the same version (a newer draft stays)
  done(id, doc) {
    if (doc && localStorage.getItem(DRAFT_KEY + id) === JSON.stringify(doc)) localStorage.removeItem(DRAFT_KEY + id);
  },
});

/** Keeps the document: its draft at once, its file with the next `flushDocs`. */
export function putDoc(doc: CueDoc) {
  try {
    localStorage.setItem(DRAFT_KEY + doc.id, JSON.stringify(doc));
  } catch {
    /* storage full: the file write still happens */
  }
  saver.put(doc.id, doc);
}

/** Deletes the document: its draft at once, its file with the next `flushDocs`. */
export function dropDoc(id: string) {
  localStorage.removeItem(DRAFT_KEY + id);
  saver.drop(id);
}

/** Writes and deletes everything asked for so far, one at a time; rejects with the first failure (kept for the next try). */
export const flushDocs = () => saver.flush();
/** something is not on disk yet */
export const unsaved = () => saver.busy();
/** the document's last change (or deletion) has not reached the disk */
export const waiting = (id: string) => saver.waiting(id);

/** The folder the documents are saved in (desktop app only). */
export const docsFolder = (): Promise<string | null> => (inTauri ? invoke<string>('docs_dir_path') : Promise.resolve(null));

// ---------------- the earlier version's single week ----------------

/** The input the first version of the app kept (1부, 2부, 4부 of one Sunday) as a document; null when nothing was typed. */
export function takeV1Week(): CueDoc | null {
  const s = localStorage.getItem(V1_KEY);
  if (!s) return null;
  try {
    return v1WeekDoc(rules, normalizeWeek(JSON.parse(s)));
  } catch {
    return null;
  }
}

/** Keeps the earlier version's week under another name, so it is moved only once. */
export function retireV1Week() {
  const s = localStorage.getItem(V1_KEY);
  if (s == null) return;
  try {
    localStorage.setItem(`${V1_KEY}.v1`, s);
  } catch {
    /* keep going: the week is already a document */
  }
  localStorage.removeItem(V1_KEY);
}

// ---------------- what was open ----------------

export interface UiState {
  kind: Kind;
  /** the document last open for each occasion */
  doc: Partial<Record<Kind, string>>;
  /** the service tab last open for each occasion */
  svc: Partial<Record<Kind, string>>;
}

export function loadUi(): UiState {
  const out: UiState = { kind: 'sunday', doc: {}, svc: {} };
  try {
    const u = JSON.parse(localStorage.getItem(UI_KEY) ?? 'null');
    if (u && typeof u === 'object') {
      if (rules.occasions.some((o) => o.id === u.kind)) out.kind = u.kind;
      for (const part of ['doc', 'svc'] as const) {
        const m = u[part];
        if (m && typeof m === 'object') for (const [k, v] of Object.entries(m)) if (typeof v === 'string') out[part][k as Kind] = v;
      }
    }
  } catch {
    /* defaults */
  }
  return out;
}

export function saveUi(u: UiState) {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(u));
  } catch {
    /* not important */
  }
}

// ---------------- files the user opens and saves ----------------

/** A .cuesheet.json file: a document of this app, or the first version's week (read as a 주일 document). */
export function docFromFile(text: string): CueDoc {
  let x: unknown;
  try {
    x = JSON.parse(text);
  } catch {
    throw new Error('큐시트 파일(JSON)이 아닙니다');
  }
  if (x && typeof x === 'object' && (x as { v?: unknown }).v === 2) {
    const d = normalizeDoc(rules, x);
    if (!d) throw new Error('큐시트 파일을 읽을 수 없습니다 (행사 종류나 날짜가 올바르지 않습니다)');
    return d;
  }
  return weekToDoc(rules, normalizeWeek(x), 'sunday');
}
