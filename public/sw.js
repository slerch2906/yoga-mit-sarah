const CACHE_VERSION = 'yoga-sarah-v7'
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

  // Alles andere: Network first, kein Cache
  event.respondWith(fetch(event.request))
})
