const CACHE_VERSION = 'yoga-sarah-v9'
const STATIC_ASSETS = ['/manifest.json']

self.addEventListener('install', event => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(STATIC_ASSETS))
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)

  // Supabase und externe APIs nie cachen
  if (url.hostname.includes('supabase.co') || 
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('fonts.')) return

  // Manifest und Icons cachen
  if (url.pathname === '/manifest.json') {
    event.respondWith(
      caches.match(event.request).then(cached => 
        cached || fetch(event.request).then(res => {
          const clone = res.clone()
          caches.open(CACHE_VERSION).then(c => c.put(event.request, clone))
          return res
        })
      )
    )
    return
  }

  // Sarah 2026-06-02: Navigationen (HTML-Dokument) IMMER frisch ohne HTTP-Cache
  // laden. Sonst kann iOS/WebKit beim Seitenaufruf ein altes Dokument liefern, das
  // veraltete JS-Chunks referenziert -> Bugfixes erreichen das Geraet trotz Deploy
  // nicht ("Hinweis kommt immer wieder"). no-store zwingt zum Netz; Fallback auf
  // normalen Fetch, falls no-store mal nicht unterstuetzt wird.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(() => fetch(event.request))
    )
    return
  }

  // Alles andere: Network first, kein Cache
  event.respondWith(fetch(event.request))
})
