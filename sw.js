/* 오프라인 동작용 서비스워커 */
// 이름을 바꿀 때 올려준다. 그러면 옛 이름이 담긴 화면이 캐시에 남지 않는다
const CACHE = 'saengsu-v5';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // 화면 진입: 새 버전을 먼저 시도하고, 인터넷이 없으면 저장된 화면을 보여준다
  if (req.mode === 'navigate'){
    e.respondWith(
      fetch(req)
        .then(res => {
          caches.open(CACHE).then(c => c.put('./index.html', res.clone()));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 그 외(아이콘·폰트 등): 저장된 것 우선, 없으면 받아서 저장
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')){
        caches.open(CACHE).then(c => c.put(req, res.clone()));
      }
      return res;
    }))
  );
});
