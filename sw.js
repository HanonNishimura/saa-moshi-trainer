/* SAA 模試トレーナー Service Worker
 * アプリ本体（シェル）だけをキャッシュしてオフライン動作させる。
 * 問題データはユーザーがインポートして端末内(localStorage)に保存されるため、
 * このSWはネットワークへ問題を一切送らない。
 */
const CACHE = 'saa-moshi-v31';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './glossary.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 外部は触らない
  if (url.pathname.indexOf('/api/') === 0) return; // API は常にネットワーク（キャッシュしない）
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((resp) => {
          // 同一オリジンの成功レスポンスはキャッシュに追加
          if (resp && resp.status === 200) {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return resp;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
