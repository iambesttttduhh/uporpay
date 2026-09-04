// Precache the shell so the alarm still works on a flaky morning wifi.
const CACHE = 'wol-v2'  // bump on any module change: the SW is cache-first for app code
const SHELL = ['/', '/index.html', '/styles.css', '/manifest.webmanifest', '/icons/app.svg']
const MODULES = [
  '/src/app.js',
  '/src/logic.js',
  '/src/engine.js',
  '/src/db.js',
  '/src/audio.js',
  '/src/camera.js',
  '/src/verify.js',
  '/src/ui.js',
  '/views/home.js',
  '/views/alarms.js',
  '/views/mission.js',
  '/views/lock.js',
  '/views/journal.js',
  '/views/settings.js',
  '/views/admin.js',
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll([...SHELL, ...MODULES]))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Navigation: network first (so a reload picks up code), cache as backup.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html')))
    return
  }
  // App code: cache first, refresh in the background.
  e.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => hit)
      return hit ?? refresh
    })
  )
})

// Kept for parity with the native build: a silent push would be the only way to
// trigger an alarm while the app is fully closed in a browser. It is NOT
// implemented here — see docs/NATIVE.md for why, and what replaces it.
self.addEventListener('push', (event) => {
  event.waitUntil(
    self.registration.showNotification('Wake or Lock', {
      body: 'The alarm only rings while this app is open. Install it, or run the native build.',
      tag: 'wol-info',
    })
  )
})
