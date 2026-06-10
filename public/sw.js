/* 小M · Service Worker：静态资源 cache-first，页面 network-first，Web Push 复习提醒 */
const CACHE = 'memory-v2';
const PRECACHE = ['/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // API 与 Supabase 请求不缓存
  if (url.pathname.startsWith('/api/')) return;

  // 页面导航：network-first，离线时回退缓存
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((c) => c || caches.match('/')))
    );
    return;
  }

  // 静态资源：cache-first
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json'
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return res;
          })
      )
    );
  }
});

/* ===== Web Push：每晨复习提醒（F3.2） ===== */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || '小M';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '今天有卡片待复习',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'memory-review-reminder',
      data: { url: data.url || '/review' },
    })
  );
});

/* 点击通知 → 直达复习页 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/review';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (new URL(client.url).pathname === url && 'focus' in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      })
  );
});
