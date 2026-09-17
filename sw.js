/* NS · XỬ LÝ ẢNH — service worker
   Tăng số phiên bản mỗi lần đổi index.html để trình duyệt tải bản mới. */
const CACHE = 'ns-anh-v2';
const FONT_CACHE = 'ns-anh-fonts-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== FONT_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Google Fonts — stale-while-revalidate (để offline vẫn có font)
  if (url.hostname.indexOf('fonts.googleapis.com') >= 0 || url.hostname.indexOf('fonts.gstatic.com') >= 0) {
    e.respondWith(caches.open(FONT_CACHE).then(async c => {
      const cached = await c.match(req);
      const net = fetch(req).then(r => { if (r && r.status === 200) c.put(req, r.clone()); return r; }).catch(() => cached);
      return cached || net;
    }));
    return;
  }

  // Cùng origin — ưu tiên cache, thiếu thì lấy mạng rồi cache lại; điều hướng offline trả về index
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(r => {
        if (r && r.status === 200 && r.type === 'basic') {
          const cp = r.clone();
          caches.open(CACHE).then(c => c.put(req, cp));
        }
        return r;
      }).catch(() => req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
    );
  }
});
