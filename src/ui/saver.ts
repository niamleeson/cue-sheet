/**
 * Writes documents to disk one at a time. Each write takes the document's newest version at the moment it runs, so an
 * older version never lands after a newer one, and a document asked to be deleted is never written again by a write
 * that was still waiting. A write that fails is tried again with the next flush (unless a newer change replaced it).
 */
export interface DocStore<T> {
  write: (id: string, doc: T) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** after a version (or the deletion, `null`) reached the disk */
  done?: (id: string, doc: T | null) => void;
}

export interface Saver<T> {
  put: (id: string, doc: T) => void;
  drop: (id: string) => void;
  /** something is waiting or being written */
  busy: () => boolean;
  /** the document's last change has not reached the disk */
  waiting: (id: string) => boolean;
  /** writes everything asked for so far; rejects with the first failure */
  flush: () => Promise<void>;
}

export function createSaver<T>(store: DocStore<T>): Saver<T> {
  const want = new Map<string, T | null>();
  let running = 0;
  let chain: Promise<void> = Promise.resolve();

  async function drain() {
    running++;
    let failed = false;
    let error: unknown;
    try {
      for (const id of [...want.keys()]) {
        if (!want.has(id)) continue;
        const doc = want.get(id) as T | null;
        want.delete(id);
        try {
          if (doc === null) await store.remove(id);
          else await store.write(id, doc);
          store.done?.(id, doc);
        } catch (e) {
          if (!want.has(id)) want.set(id, doc);
          if (!failed) {
            failed = true;
            error = e;
          }
        }
      }
    } finally {
      running--;
    }
    if (failed) throw error;
  }

  return {
    put: (id, doc) => void want.set(id, doc),
    drop: (id) => void want.set(id, null),
    busy: () => want.size > 0 || running > 0,
    waiting: (id) => want.has(id),
    flush() {
      const p = chain.then(drain);
      chain = p.catch(() => undefined);
      return p;
    },
  };
}
