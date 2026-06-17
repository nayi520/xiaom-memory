/* 小M · Service Worker：静态资源 cache-first，页面 network-first，Web Push 复习提醒，离线捕获 Background Sync */
const CACHE = 'memory-v3';
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
  const url = data.url || '/review';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '今天有卡片待复习',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'memory-review-reminder',
      // 同 tag 复盖旧通知但仍提示用户（避免堆叠、又不至于静默更新）。
      renotify: true,
      // 「去复习」操作按钮，一键直达（不支持 actions 的平台自动忽略）。
      actions: [{ action: 'review', title: '去复习' }],
      data: { url },
    })
  );
});

/* 点击通知（或其操作按钮）→ 直达复习页：优先聚焦已开窗口并导航，否则新开。 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/review';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          // 任一同源窗口：聚焦并导航到目标页（比仅匹配同 path 更稳，避免重复开窗）。
          if ('focus' in client) {
            if ('navigate' in client && new URL(client.url).pathname !== url) {
              return client.focus().then((c) => (c && c.navigate ? c.navigate(url) : c));
            }
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      })
  );
});

/* ===== 离线捕获 Background Sync（V10） =====
 * 恢复网络后，浏览器触发 tag='mxiao-outbox-sync' 的 sync 事件。
 * 这里直接回放 IndexedDB 队列（mxiao-offline/outbox）到 /api/notes、/api/clip，
 * 覆盖「页面已关」的场景；同时 postMessage 通知在线页面刷新 UI。
 * 队列结构与 src/features/offline/queue.ts 一致（keyPath: clientId）。
 */
const OUTBOX_DB = 'mxiao-offline';
const OUTBOX_STORE = 'outbox';
const OUTBOX_MAX_ATTEMPTS = 5;

function openOutboxDb() {
  return new Promise((resolve, reject) => {
    // 不指定版本：打开「当前已存在的版本」，避免前台升过版本后 SW 用旧版本号 open 触发 VersionError。
    // 不建库：库由前台页面创建；若 store 缺失，下方读取做容错。
    const req = indexedDB.open(OUTBOX_DB);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readPendingOutbox(db) {
  if (!db.objectStoreNames.contains(OUTBOX_STORE)) return [];
  const store = db.transaction(OUTBOX_STORE, 'readonly').objectStore(OUTBOX_STORE);
  const all = (await idbReq(store.getAll())) || [];
  return all.filter((i) => i && i.status === 'pending');
}

async function putOutbox(db, item) {
  if (!db.objectStoreNames.contains(OUTBOX_STORE)) return;
  const store = db.transaction(OUTBOX_STORE, 'readwrite').objectStore(OUTBOX_STORE);
  await idbReq(store.put(item));
}

async function deleteOutbox(db, clientId) {
  if (!db.objectStoreNames.contains(OUTBOX_STORE)) return;
  const store = db.transaction(OUTBOX_STORE, 'readwrite').objectStore(OUTBOX_STORE);
  await idbReq(store.delete(clientId));
}

async function replayOutbox() {
  let db;
  try {
    db = await openOutboxDb();
  } catch {
    return 0;
  }
  let synced = 0;
  let items;
  try {
    items = await readPendingOutbox(db);
  } catch {
    return 0;
  }
  for (const item of items) {
    const endpoint = item.kind === 'clip' ? '/api/clip' : '/api/notes';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 注入幂等键，与前台同口径
        body: JSON.stringify({ ...item.payload, client_id: item.clientId }),
      });
      if (res.ok) {
        await deleteOutbox(db, item.clientId);
        synced += 1;
      } else if (res.status === 401) {
        // 会话过期：保持 pending、不计 attempts，终止本轮等用户在前台重登后再同步（与前台同口径）。
        break;
      } else if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        // 客户端错误：标 failed，停自动重试
        await putOutbox(db, {
          ...item,
          status: 'failed',
          attempts: (item.attempts || 0) + 1,
          lastError: `提交被拒绝（${res.status}）`,
        });
      } else {
        const attempts = (item.attempts || 0) + 1;
        await putOutbox(db, {
          ...item,
          attempts,
          status: attempts >= OUTBOX_MAX_ATTEMPTS ? 'failed' : 'pending',
          lastError: `服务暂不可用（${res.status}）`,
        });
      }
    } catch {
      const attempts = (item.attempts || 0) + 1;
      await putOutbox(db, {
        ...item,
        attempts,
        status: attempts >= OUTBOX_MAX_ATTEMPTS ? 'failed' : 'pending',
        lastError: '网络错误',
      });
      // 网络仍不可用：终止本轮，等下次 sync 重试。
      break;
    }
  }
  return synced;
}

async function notifyClientsSync() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ type: 'mxiao-outbox-sync' });
  }
}

async function handleOutboxSync() {
  // 若有可见页面在线，交给页面 flush（避免 SW 与页面并发回放同一条 → 重复提交）；
  // 否则（页面已关/后台）由 SW 直接回放队列。
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const hasVisible = clients.some((c) => c.visibilityState === 'visible');
  if (hasVisible) {
    await notifyClientsSync();
    return;
  }
  await replayOutbox().catch(() => 0);
  // 回放后通知任何后台页面对账 UI（不会触发重复 flush，因其不可见时不主动 sync）。
  await notifyClientsSync().catch(() => {});
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'mxiao-outbox-sync') {
    event.waitUntil(handleOutboxSync());
  }
});
