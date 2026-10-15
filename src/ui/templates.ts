import t1 from '../templates/service1.docx?url';
import t2 from '../templates/service2.docx?url';
import t4 from '../templates/service4.docx?url';

/** Word templates bundled with the app (earlier cue sheets of each service, cleaned). */
const BUNDLED: Record<string, string> = { 'service1.docx': t1, 'service2.docx': t2, 'service4.docx': t4 };
const key = (sid: string) => `cuesheet.template.${sid}`;

export interface CustomTemplate { name: string; data: string; savedAt: string }

export function customTemplate(sid: string): CustomTemplate | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(sid)) ?? 'null');
    return v && typeof v.data === 'string' ? v : null;
  } catch {
    return null;
  }
}

export function setCustomTemplate(sid: string, name: string, bytes: Uint8Array) {
  localStorage.setItem(key(sid), JSON.stringify({ name, data: toBase64(bytes), savedAt: new Date().toISOString() }));
}

export function clearCustomTemplate(sid: string) {
  localStorage.removeItem(key(sid));
}

/** The template to fill for a service: the user's own if set, otherwise the bundled one. */
export async function templateBytes(sid: string, file: string): Promise<Uint8Array> {
  const c = customTemplate(sid);
  if (c) return fromBase64(c.data);
  const url = BUNDLED[file];
  if (!url) throw new Error(`기본 서식이 없습니다: ${file}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`기본 서식을 읽지 못했습니다: ${file} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
