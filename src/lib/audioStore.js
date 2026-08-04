// Call audio blobs live in IndexedDB (localStorage is text-only and too small);
// keyed by the record's _id. Callers .catch(() => {}) — a storage failure must
// never block a save, the audio is also downloaded as a file.
const DB = "us24_vob", STORE = "audio";

const open = () => new Promise((res, rej) => {
  const q = indexedDB.open(DB, 1);
  q.onupgradeneeded = () => q.result.createObjectStore(STORE);
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

export const putAudio = (id, blob) => tx("readwrite", (s) => s.put(blob, id));
export const getAudio = (id) => tx("readonly", (s) => s.get(id));
export const delAudio = (id) => tx("readwrite", (s) => s.delete(id));
export const clearAudio = () => tx("readwrite", (s) => s.clear());
