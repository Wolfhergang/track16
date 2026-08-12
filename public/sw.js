// STEP16 service worker.
//
// Everything the app needs is precached at install, so a launch with no network
// (or an installed PWA opened in airplane mode) works exactly like an online one.
// `scripts/gen-sw.js` rewrites the two constants below at build time with the
// real hashed asset names and a version derived from their content.

const VERSION = 'dev'
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
]

const CACHE = `step16-${VERSION}`

// Older WebKit throws on `new Request(url, { cache: 'reload' })`, so bypass the
// HTTP cache with a query-busted fetch instead and store it under the clean URL.
const precache = (cache, url) =>
  cache.add(url).catch(() =>
    fetch(`${url}${url.includes('?') ? '&' : '?'}sw=${VERSION}`)
      .then(res => (res.ok ? cache.put(url, res) : null))
      .catch(() => null),
  )

self.addEventListener('install', e => {
  e.waitUntil(
    // One bad URL must not fail the whole install — cache what we can.
    caches.open(CACHE).then(cache => Promise.all(SHELL.map(url => precache(cache, url)))),
  )
  // No skipWaiting: an update installs quietly and takes over on the next
  // launch, so a running session never has its assets swapped mid-pattern.
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      // iOS evicts caches under storage pressure, which would silently break
      // offline. Refill anything missing every time the worker starts up.
      .then(() => caches.open(CACHE))
      .then(cache =>
        Promise.all(
          SHELL.map(url =>
            cache.match(url).then(hit => (hit ? null : precache(cache, url))),
          ),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', e => {
  if (e.data === 'skip-waiting') self.skipWaiting() // used by the update prompt
})

// respondWith() must always settle with a Response. Resolving to undefined (a
// cache miss whose network fetch then failed) is what makes Safari report
// "FetchEvent.respondWith received an error", so every path ends in one.
const offline = () =>
  new Response('', { status: 503, statusText: 'Offline', headers: { 'Cache-Control': 'no-store' } })

// The copy has to be taken *now*, synchronously: `res` is handed straight back
// to respondWith(), which starts reading its body. Cloning later — inside the
// caches.open() callback — throws "Response body is already used".
const store = (req, res) => {
  if (res?.ok) {
    const copy = res.clone()
    caches
      .open(CACHE)
      .then(c => c.put(req, copy))
      .catch(() => null) // a full or evicted cache must not reject into the page
  }
  return res
}

// Cache first, always: if it is in the cache the network is never consulted, so
// a launch costs nothing and behaves the same on a dead connection as on a good
// one. Only a miss goes out to the network. New builds still arrive — the
// browser revalidates sw.js itself, and a changed VERSION precaches the new
// assets and prompts to reload.
self.addEventListener('fetch', e => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin) return

  // Any navigation resolves to the one cached shell.
  const key = req.mode === 'navigate' ? './index.html' : req

  e.respondWith(
    caches
      .match(key)
      .then(hit => hit || (req.mode === 'navigate' ? caches.match('./') : null))
      .then(hit => hit || fetch(req).then(res => store(key, res)))
      .catch(() => offline())
      .then(res => res || offline()),
  )
})
