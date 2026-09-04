// ---------------------------------------------------------------------------
// db.js — IndexedDB with an in-memory + localStorage fallback.
//
// Two things matter here for an app whose whole job is "you cannot escape":
//   1. the active episode is written synchronously-ish on every transition, so
//      a refresh or a crash cannot be used to reset a running lockout;
//   2. captures are stored as JPEG data URLs in the IDB `shots` store rather
//      than localStorage: a morning's worth of frames blows past the 5 MB
//      quota there, and evidence that gets evicted is evidence that didn't
//      happen. They must still be readable after a reload so the journal can
//      replay them and a rejected shot can stay on the record.
// ---------------------------------------------------------------------------

const DB_NAME = 'wake-or-lock'
const DB_VERSION = 1
export const STORES = ['alarms', 'episodes', 'events', 'settings', 'shots']

let idb = null
let useFallback = false
const mem = { alarms: new Map(), episodes: new Map(), events: new Map(), settings: new Map(), shots: new Map() }

function open() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      useFallback = true
      loadFromLocalStorage()
      return resolve(null)
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      for (const name of STORES) {
        if (!d.objectStoreNames.contains(name)) {
          d.createObjectStore(name, { keyPath: 'id' })
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      useFallback = true
      loadFromLocalStorage()
      resolve(null)
    }
    req.onblocked = () => {
      useFallback = true
      resolve(null)
    }
  })
}

function loadFromLocalStorage() {
  try {
    for (const name of STORES) {
      const raw = localStorage.getItem(`${DB_NAME}:${name}`)
      if (!raw) continue
      for (const row of JSON.parse(raw)) mem[name].set(row.id, row)
    }
  } catch {
    /* private mode / quota — memory only for this session */
  }
}

function flushFallback() {
  try {
    for (const name of STORES) {
      // blobs don't serialize; keep shots as dataURL strings which they already are
      localStorage.setItem(`${DB_NAME}:${name}`, JSON.stringify([...mem[name].values()]))
    }
  } catch {
    /* ignore */
  }
}

export async function put(store, value) {
  await dbReady
  if (useFallback || !idb) {
    mem[store].set(value.id, value)
    flushFallback()
    return value
  }
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(store, 'readwrite')
    tx.objectStore(store).put(structuredClone(value))
    tx.oncomplete = () => resolve(value)
    tx.onerror = () => reject(tx.error)
  })
}

export async function getAll(store) {
  await dbReady
  if (useFallback || !idb) return [...mem[store].values()]
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(store, 'readonly')
    const req = tx.objectStore(store).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function get(store, id) {
  await dbReady
  if (useFallback || !idb) return mem[store].get(id) ?? null
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(store, 'readonly')
    const req = tx.objectStore(store).get(id)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function del(store, id) {
  await dbReady
  if (useFallback || !idb) {
    mem[store].delete(id)
    flushFallback()
    return
  }
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(store, 'readwrite')
    tx.objectStore(store).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearStore(store) {
  await dbReady
  if (useFallback || !idb) {
    mem[store].clear()
    flushFallback()
    return
  }
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(store, 'readwrite')
    tx.objectStore(store).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function deleteDatabase() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined' || !idb) return resolve()
    idb.close()
    idb = null
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

export async function wipeEverything() {
  await Promise.all(STORES.map((s) => clearStore(s)))
  await deleteDatabase()
  idb = await open()
}

export const isFallback = () => useFallback

export const dbReady = open().then((d) => {
  idb = d
  return d
})
