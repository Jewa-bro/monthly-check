/* 오프라인 동작용 서비스워커 */
// 이름을 바꿀 때 올려준다. 그러면 옛 이름이 담긴 화면이 캐시에 남지 않는다
const CACHE = 'saengsu-v20';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon.png',
];

/* 밖에서 받아오는 것들. 오프라인에서도 앱이 열리도록 설치할 때 미리 받아둔다.
   런타임에 받아 저장하는 방식은 이 환경에서 확실하지 않아서, 여기서 확실히 챙긴다.
   하나가 실패해도 설치 자체가 깨지지 않게 개별로 담는다. */
const OUTSIDE = [
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);                       // 앱 파일은 반드시 있어야 한다
    await Promise.all(OUTSIDE.map(async u => {   // 없어도 앱은 열린다
      try{
        const res = await fetch(u, { mode:'cors' });
        if (res.ok) await c.put(u, res);
      }catch(err){ /* 인터넷이 없으면 다음 기회에 */ }
    }));
    await self.skipWaiting();
  })());
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

  // 캐시해도 되는 것은 '변하지 않는 정적 파일' 뿐이다.
  // 로그인·동기화 통신(googleapis.com 등)을 캐시하면 옛 응답을 돌려줘서 동기화가 깨진다.
  const url = new URL(req.url);
  const 정적파일 =
    url.origin === location.origin ||                                  // 앱 파일
    (url.host === 'www.gstatic.com' && url.pathname.includes('/firebasejs/')) ||  // Firebase SDK
    url.host === 'cdn.jsdelivr.net';                                   // 글꼴
  if (!정적파일) return;                                                // 그대로 네트워크로 보낸다

  // 저장된 것 우선, 없으면 받아서 저장.
  // put 은 응답을 돌려준 뒤에 끝나므로 waitUntil 로 워커가 살아있게 잡아둔다
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res && res.ok && res.type !== 'opaque'){
      const copy = res.clone();
      e.waitUntil(
        caches.open(CACHE)
          .then(c => c.put(req, copy))
          .catch(err => console.warn('[sw] 캐시 저장 실패', req.url, err))
      );
    }
    return res;
  })());
});
