// Legacy store. Audio upload was removed — the app now takes transcripts directly —
// but records saved before that still have a blob here, keyed by the record's _id,
// and the log's "Audio" button must keep working for them. Read and delete only:
// nothing writes to this store any more.
const DB = "us24_vob", STORE = "audio";

const open = () => new Promise((res, rej) => {
  const q = indexedDB.open(DB, 1);
  // Guarded: the data layer opens this same database at a higher version, and an
  // unconditional createObjectStore throws ConstraintError on every existing install.
  q.onupgradeneeded = () => {
    const db = q.result;
    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
  };
  q.onsuccess = () => res(q.result);
  q.onerror = () => rej(q.error);
});

const tx = (mode, fn) => open().then((db) => new Promise((res, rej) => {
  let t;
  try { t = db.transaction(STORE, mode); } catch (e) { db.close(); rej(e); return; }
  let r;
  try { r = fn(t.objectStore(STORE)); } catch (e) { db.close(); rej(e); return; }
  t.oncomplete = () => { db.close(); res(r && r.result); };
  t.onerror = () => { db.close(); rej(t.error); };
  // A commit-time failure (e.g. quota exceeded) fires only 'abort' — without
  // this the promise would never settle and the caller's await would hang.
  t.onabort = () => { db.close(); rej(t.error || new DOMException("Transaction aborted", "AbortError")); };
}));

export const getAudio = (id) => tx("readonly", (s) => s.get(id));
export const delAudio = (id) => tx("readwrite", (s) => s.delete(id));
export const clearAudio = () => tx("readwrite", (s) => s.clear());
