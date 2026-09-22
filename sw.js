/* NS · XỬ LÝ ẢNH — service worker
   Tăng số phiên bản CACHE mỗi lần đổi index.html để trình duyệt tải bản mới.
   Model AI + thư viện AI để ở cache RIÊNG, không bị xoá khi lên phiên bản. */
const CACHE = 'ns-anh-v9';
const FONT_CACHE = 'ns-anh-fonts-v1';
const MODEL_CACHE = 'ns-model-isnet-v1';
const LIB_CACHE = 'ns-lib-ort-1.30.0';
const KEEP = [CACHE, FONT_CACHE, MODEL_CACHE, LIB_CACHE];
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => KEEP.indexOf(k) < 0 && k.indexOf('ns-model-') !== 0).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Bật cách ly nguồn (COOP/COEP credentialless) cho trang -> Chrome cho AI chạy nhiều luồng CPU */
function isolate(resp) {
  if (!resp || resp.status !== 200 || resp.type === 'opaque') return resp;
  const h = new Headers(resp.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'credentialless');
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

function cacheFirst(cacheName, req) {
  return caches.open(cacheName).then(async c => {
    const hit = await c.match(req);
    if (hit) return hit;
    const r = await fetch(req);
    if (r && r.status === 200) c.put(req, r.clone());
    return r;
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Google Fonts — stale-while-revalidate
  if (url.hostname.indexOf('fonts.googleapis.com') >= 0 || url.hostname.indexOf('fonts.gstatic.com') >= 0) {
    e.respondWith(caches.open(FONT_CACHE).then(async c => {
      const cached = await c.match(req);
      const net = fetch(req).then(r => { if (r && r.status === 200) c.put(req, r.clone()); return r; }).catch(() => cached);
      return cached || net;
    }));
    return;
  }

  // Thư viện AI (onnxruntime-web, bản cố định) — cache-first, giữ lâu dài
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.indexOf('/onnxruntime-web@') >= 0) {
    e.respondWith(cacheFirst(LIB_CACHE, req));
    return;
  }

  if (url.origin !== location.origin) return;

  // Model AI (./models/...) — cache-first vào cache riêng, không bị xoá khi cập nhật app
  if (url.pathname.indexOf('/models/') >= 0) {
    if (url.pathname.slice(-5) === '.json') {   // mục lục model: ưu tiên mạng để nhận bản mới
      e.respondWith(fetch(req).then(r => { if (r && r.status === 200) { const cp = r.clone(); caches.open(MODEL_CACHE).then(c => c.put(req, cp)); } return r; })
        .catch(() => caches.open(MODEL_CACHE).then(c => c.match(req))));
    } else {
      e.respondWith(cacheFirst(MODEL_CACHE, req));
    }
    return;
  }

  // Trang chính — thêm header cách ly; ưu tiên cache, thiếu thì mạng
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(r => {
        if (r && r.status === 200 && r.type === 'basic') { const cp = r.clone(); caches.open(CACHE).then(c => c.put('./index.html', cp)); }
        return isolate(r);
      }).catch(() => caches.match('./index.html').then(isolate))
    );
    return;
  }

  // Tài nguyên cùng origin khác — cache-first
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r && r.status === 200 && r.type === 'basic') { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
      return r;
    }))
  );
});
