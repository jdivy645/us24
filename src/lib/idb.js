// IndexedDB plumbing. Nothing in here knows about VOBs.
//
// Two traps worth naming, because both are silent:
//
//  * A commit-time failure (quota exceeded, most often) fires only 'abort' — never
//    'error'. Without the onabort handler the promise never settles and the
//    caller's await hangs forever. This was already learned once in audioStore.js.
//
//  * Transactions auto-commit on any turn of the event loop with no request
//    pending. So every non-IDB step — reading a blob, computing keys, diffing —
//    has to happen BEFORE the transaction opens. Awaiting anything else inside one
//    kills it. This is the single most common way IndexedDB code breaks.
import { DB_NAME, DB_VERSION, STORES } from "./schema.js";

let _db = null;

export function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const q = indexedDB.open(DB_NAME, DB_VERSION);
    q.onupgradeneeded = () => {
      const db = q.result;
      for (const [name, spec] of Object.entries(STORES)) {
        const store = db.objectStoreNames.contains(name)
          ? q.transaction.objectStore(name)
          : db.createObjectStore(name, spec.keyPath ? { keyPath: spec.keyPath } : undefined);
        for (const ix of spec.indexes || []) {
          if (!store.indexNames.contains(ix.name)) {
            store.createIndex(ix.name, ix.on, { unique: !!ix.unique, multiEntry: !!ix.multiEntry });
          }
        }
      }
    };
    q.onsuccess = () => {
      _db = q.result;
      // Another tab upgrading the schema would otherwise block forever.
      _db.onversionchange = () => { _db.close(); _db = null; };
      res(_db);
    };
    q.onerror = () => rej(q.error);
    q.onblocked = () => rej(new Error("Another tab has this database open at an older version. Close it and reload."));
  });
}

const wrap = (req) => new Promise((res, rej) => {
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});

// fn receives a { storeName: objectStore } map and a `wrap` that turns an
// IDBRequest into a promise. fn may await those, and nothing else: awaiting any
// other promise lets the transaction auto-commit underneath it.
//
// The commit handler is attached BEFORE fn runs, so a transaction that finishes
// early cannot slip past it — that ordering is the whole reason this is not just
// `new Promise(...)` around the callback.
export async function tx(names, mode, fn) {
  const db = await openDb();
  const list = Array.isArray(names) ? names : [names];
  const t = db.transaction(list, mode);
  const settled = new Promise((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new DOMException("Transaction aborted", "AbortError"));
  });
  const stores = Object.fromEntries(list.map((n) => [n, t.objectStore(n)]));

  let value;
  try {
    value = await fn(stores, wrap);
  } catch (e) {
    try { t.abort(); } catch { /* already dead */ }
    throw e;
  }
  await settled;   // the write is not real until the transaction commits
  return value;
}

export const get = (store, key) => tx(store, "readonly", (s, w) => w(s[store].get(key)));
export const getAll = (store) => tx(store, "readonly", (s, w) => w(s[store].getAll()));
export const put = (store, value, key) => tx(store, "readwrite", (s, w) => w(key === undefined ? s[store].put(value) : s[store].put(value, key)));
export const del = (store, key) => tx(store, "readwrite", (s, w) => w(s[store].delete(key)));
export const clear = (store) => tx(store, "readwrite", (s, w) => w(s[store].clear()));
export const byIndex = (store, index, key) =>
  tx(store, "readonly", (s, w) => w(s[store].index(index).getAll(key)));
export const oneByIndex = (store, index, key) =>
  tx(store, "readonly", (s, w) => w(s[store].index(index).get(key)));

export const getMeta = (key) => get("meta", key);
export const setMeta = (key, value) => put("meta", value, key);

// Best-effort protection against the browser evicting the only copy of the data.
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) return await navigator.storage.persist();
  } catch { /* not supported — nothing to do */ }
  return false;
}

export async function storageEstimate() {
  try { return (await navigator.storage?.estimate?.()) || null; } catch { return null; }
}
