import { describe, expect, it } from 'vitest';
import { createSaver } from '../src/ui/saver';

interface Doc { v: number }

/** a disk whose writes can be held back and then let through or failed, one at a time */
function setup() {
  const disk = new Map<string, number>();
  const ops: string[] = [];
  const done: string[] = [];
  const held: { go: () => void; fail: (e: Error) => void }[] = [];
  let holding = false;
  const run = (what: string, apply: () => void) =>
    new Promise<void>((resolve, reject) => {
      const go = () => {
        apply();
        ops.push(what);
        resolve();
      };
      const fail = (e: Error) => {
        ops.push(`${what} failed`);
        reject(e);
      };
      if (holding) held.push({ go, fail });
      else go();
    });
  const saver = createSaver<Doc>({
    write: (id, d) => run(`write ${id}${d.v}`, () => disk.set(id, d.v)),
    remove: (id) => run(`remove ${id}`, () => disk.delete(id)),
    done: (id, d) => done.push(d ? `${id}${d.v}` : `-${id}`),
  });
  return { saver, disk, ops, done, held, hold: (on: boolean) => (holding = on) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('saver', () => {
  it('writes the newest version last, even when it changes while an older one is being written', async () => {
    const t = setup();
    t.hold(true);
    t.saver.put('A', { v: 1 });
    const f1 = t.saver.flush();
    await tick();
    expect(t.saver.busy()).toBe(true);
    t.saver.put('A', { v: 2 });
    const f2 = t.saver.flush();
    t.hold(false);
    t.held.shift()!.go();
    await f1;
    await f2;
    expect(t.disk.get('A')).toBe(2);
    expect(t.ops).toEqual(['write A1', 'write A2']);
    expect(t.done).toEqual(['A1', 'A2']);
    expect(t.saver.busy()).toBe(false);
  });

  it('a document deleted while another one is being written is not written afterwards', async () => {
    const t = setup();
    t.hold(true);
    t.saver.put('B', { v: 1 });
    t.saver.put('A', { v: 1 });
    const f1 = t.saver.flush();
    await tick();
    t.saver.drop('A');
    const f2 = t.saver.flush();
    t.hold(false);
    t.held.shift()!.go();
    await f1;
    await f2;
    expect(t.ops).toEqual(['write B1', 'remove A']);
    expect([...t.disk.keys()]).toEqual(['B']);
  });

  it('a document deleted while its own write is running is deleted after it', async () => {
    const t = setup();
    t.hold(true);
    t.saver.put('A', { v: 1 });
    const f1 = t.saver.flush();
    await tick();
    t.saver.drop('A');
    const f2 = t.saver.flush();
    t.hold(false);
    t.held.shift()!.go();
    await f1;
    await f2;
    expect(t.ops).toEqual(['write A1', 'remove A']);
    expect(t.disk.has('A')).toBe(false);
    expect(t.done).toEqual(['A1', '-A']);
  });

  it('a failed write is tried again with the next flush', async () => {
    const t = setup();
    t.hold(true);
    t.saver.put('A', { v: 1 });
    const f1 = t.saver.flush();
    await tick();
    t.hold(false);
    t.held.shift()!.fail(new Error('disk full'));
    await expect(f1).rejects.toThrow('disk full');
    expect(t.saver.waiting('A')).toBe(true);
    expect(t.done).toEqual([]);
    await t.saver.flush();
    expect(t.ops).toEqual(['write A1 failed', 'write A1']);
    expect(t.disk.get('A')).toBe(1);
    expect(t.saver.busy()).toBe(false);
  });

  it('a failed write does not replace a newer version or a deletion asked meanwhile', async () => {
    for (const later of ['put', 'drop'] as const) {
      const t = setup();
      t.hold(true);
      t.saver.put('A', { v: 1 });
      const f1 = t.saver.flush();
      await tick();
      if (later === 'put') t.saver.put('A', { v: 2 });
      else t.saver.drop('A');
      t.hold(false);
      t.held.shift()!.fail(new Error('busy'));
      await expect(f1).rejects.toThrow('busy');
      await t.saver.flush();
      expect(t.ops).toEqual(['write A1 failed', later === 'put' ? 'write A2' : 'remove A']);
      expect(t.disk.get('A')).toBe(later === 'put' ? 2 : undefined);
    }
  });

  it('one failure does not stop the other documents', async () => {
    const t = setup();
    t.hold(true);
    t.saver.put('X', { v: 1 });
    t.saver.put('Y', { v: 1 });
    const f = t.saver.flush();
    await tick();
    t.held.shift()!.fail(new Error('locked'));
    await tick();
    t.held.shift()!.go();
    await expect(f).rejects.toThrow('locked');
    expect(t.disk.get('Y')).toBe(1);
    expect([t.saver.waiting('X'), t.saver.waiting('Y')]).toEqual([true, false]);
  });
});
